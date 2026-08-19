import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TypeWireConfigError,
  loadTypeWireConfig,
  mergeConfig,
  parseJsonc,
  readTsconfigAliases,
  requireTypeFetch,
  resolveTypeFetchClient,
  selectProjects,
} from "../config";
import type { ResolvedTypeFetchSection } from "../config";

/** Every test gets its own directory: discovery walks up, so shared state leaks. */
let root: string;
const warnings: string[] = [];

const onWarn = (message: string) => {
  warnings.push(message);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "typewire-config-"));
  warnings.length = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(relativePath: string, content: string): Promise<string> {
  const full = join(root, relativePath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content, "utf8");
  return full;
}

/** A contracts object needs no zod for the loader's purposes — it only shape-checks. */
const CONTRACTS = `{ user: { getUser: { method: "GET", path: "/users/:id" } } }`;

describe("typewire.config", () => {
  describe("discovery", () => {
    it("walks up from cwd so a monorepo package inherits the root config", async () => {
      await write(
        "typewire.config.ts",
        `export default { typefetch: { contracts: ${CONTRACTS} } };`,
      );
      await mkdir(join(root, "packages", "api", "src"), { recursive: true });

      const config = await loadTypeWireConfig({
        cwd: join(root, "packages", "api", "src"),
        onWarn,
      });

      expect(config.path).toBe(join(root, "typewire.config.ts"));
      expect(config.typefetch?.contracts).toHaveProperty("user.getUser");
    });

    it("prefers the nearest config over the root one", async () => {
      await write(
        "typewire.config.ts",
        `export default { typefetch: { contracts: {} } };`,
      );
      const nested = await write(
        "packages/api/typewire.config.ts",
        `export default { typefetch: { contracts: ${CONTRACTS} } };`,
      );

      const config = await loadTypeWireConfig({
        cwd: join(root, "packages", "api"),
        onWarn,
      });

      expect(config.path).toBe(nested);
    });

    it("names what it searched for when nothing is found", async () => {
      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /typewire\.config\.\{ts,mts,cts,js,mjs,cjs\}[\s\S]*typewire init/,
      );
    });

    it("treats a missing --config as an error, never a fallback", async () => {
      await write(
        "typewire.config.ts",
        `export default { typefetch: { contracts: {} } };`,
      );

      // Silently discovering a different file than the one the user named is
      // the worst possible outcome: the run succeeds against the wrong config.
      await expect(
        loadTypeWireConfig({ cwd: root, configPath: "./nope.ts", onWarn }),
      ).rejects.toThrow(/nope\.ts, which does not exist/);
    });

    it("carries exit code 2 so CI can tell misconfiguration from findings", async () => {
      const error = await loadTypeWireConfig({ cwd: root, onWarn }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(TypeWireConfigError);
      expect((error as TypeWireConfigError).exitCode).toBe(2);
    });
  });

  describe("the legacy file", () => {
    it("still loads typefetch.test.config.ts, and says so", async () => {
      await write(
        "typefetch.test.config.ts",
        `export default { contracts: ${CONTRACTS} };`,
      );

      const config = await loadTypeWireConfig({ cwd: root, onWarn });

      expect(config.legacy).toBe(true);
      expect(config.typefetch?.contracts).toHaveProperty("user.getUser");
      expect(warnings.join("\n")).toMatch(/Rename it to typewire\.config\.ts/);
    });

    it("lifts the old flat shape into the typefetch section", async () => {
      await write(
        "typewire.config.ts",
        `export default {
           contracts: ${CONTRACTS},
           options: { mode: "full" },
           report: { output: "./out" },
         };`,
      );

      const config = await loadTypeWireConfig({ cwd: root, onWarn });

      expect(config.typefetch?.test.options).toEqual({ mode: "full" });
      expect(config.typefetch?.test.report).toEqual({ output: "./out" });
    });

    it("normalises loose section keys into test, and lets explicit test win", async () => {
      await write(
        "typewire.config.ts",
        `export default {
           typefetch: {
             contracts: ${CONTRACTS},
             options: { mode: "schema" },
             context: { tenant: "acme" },
             test: { options: { mode: "live" } },
           },
         };`,
      );

      const config = await loadTypeWireConfig({ cwd: root, onWarn });

      expect(config.typefetch?.test.options).toEqual({ mode: "live" });
      expect(config.typefetch?.test.context).toEqual({ tenant: "acme" });
      expect(warnings.join("\n")).toMatch(/deprecated/);
    });
  });

  describe("extends", () => {
    it("merges a base, with the extending file winning", async () => {
      await write(
        "base.config.ts",
        `export default {
           lint: { rules: { "path-params-declared": "error", "duplicate-id": "error" } },
           typefetch: { contracts: ${CONTRACTS}, test: { options: { timeout: 1000 } } },
         };`,
      );
      await write(
        "typewire.config.ts",
        `export default {
           extends: "./base.config.ts",
           lint: { rules: { "duplicate-id": "off" } },
           typefetch: { contracts: {}, test: { options: { mode: "full" } } },
         };`,
      );

      const config = await loadTypeWireConfig({ cwd: root, onWarn });

      // Regression: jiti evaluates config files in their own realm, so an
      // `Object.getPrototypeOf(v) === Object.prototype` merge guard passes for
      // hand-built fixtures and fails for every real file — making `extends`
      // silently replace nested keys instead of merging them. This assertion
      // only holds when the guard is realm-safe.
      // Merged key by key, not replaced wholesale.
      expect(config.lint.rules).toEqual({
        "path-params-declared": "error",
        "duplicate-id": "off",
      });
      expect(config.typefetch?.test.options).toEqual({
        timeout: 1000,
        mode: "full",
      });
      // Contracts merge module by module: shared modules in the base.
      expect(config.typefetch?.contracts).toHaveProperty("user.getUser");
    });

    it("records every file that contributed, base-most first", async () => {
      await write("base.config.ts", `export default { typefetch: { contracts: {} } };`);
      await write(
        "typewire.config.ts",
        `export default { extends: "./base.config.ts", typefetch: { contracts: ${CONTRACTS} } };`,
      );

      const config = await loadTypeWireConfig({ cwd: root, onWarn });

      expect(config.sources).toEqual([
        join(root, "base.config.ts"),
        join(root, "typewire.config.ts"),
      ]);
    });

    it("reports a cycle instead of hanging", async () => {
      await write("a.config.ts", `export default { extends: "./b.config.ts", typefetch: { contracts: {} } };`);
      await write("b.config.ts", `export default { extends: "./a.config.ts", typefetch: { contracts: {} } };`);
      await write("typewire.config.ts", `export default { extends: "./a.config.ts", typefetch: { contracts: {} } };`);

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /Circular "extends"/,
      );
    });

    it("explains an unresolvable base rather than throwing MODULE_NOT_FOUND", async () => {
      await write(
        "typewire.config.ts",
        `export default { extends: "@acme/nope", typefetch: { contracts: {} } };`,
      );

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /Could not resolve "@acme\/nope"[\s\S]*install the package/,
      );
    });
  });

  describe("tsconfig path aliases", () => {
    it("loads a config whose contracts import through @/", async () => {
      // Every Next.js and Vite scaffold sets this up, so a contract file
      // importing `@/schemas` is the normal case, not an exotic one. Without
      // alias resolution the config simply fails to load.
      await write(
        "tsconfig.json",
        `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }`,
      );
      await write("src/contracts.ts", `export const contracts = ${CONTRACTS};`);
      await write(
        "typewire.config.ts",
        `import { contracts } from "@/contracts";
         export default { typefetch: { contracts } };`,
      );

      const config = await loadTypeWireConfig({ cwd: root, onWarn });

      expect(config.typefetch?.contracts).toHaveProperty("user.getUser");
    });
  });

  describe("a config as a function", () => {
    it("receives the mode, the command and CI, so one file covers both", async () => {
      await write(
        "typewire.config.ts",
        `export default (env) => ({
           typefetch: { contracts: {} },
           diff: { baseline: env.mode === "ci" ? "ci.lock.json" : "local.lock.json" },
           typesocket: { events: { seen: { mode: env.mode, command: env.command, ci: env.ci } } },
         });`,
      );

      const config = await loadTypeWireConfig({
        cwd: root,
        mode: "ci",
        command: "diff",
        onWarn,
      });

      expect(config.diff.baseline).toBe("ci.lock.json");
      expect(config.typesocket?.events).toEqual({
        seen: { mode: "ci", command: "diff", ci: Boolean(process.env.CI) },
      });
    });

    it("attributes a throw inside the config function to the file", async () => {
      await write(
        "typewire.config.ts",
        `export default () => { throw new Error("DATABASE_URL is not set"); };`,
      );

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /config function in[\s\S]*DATABASE_URL is not set/,
      );
    });
  });

  describe("validation points at the offending key", () => {
    it("rejects a missing contracts with the key path", async () => {
      await write("typewire.config.ts", `export default { typefetch: {} };`);

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /typewire\.config\.ts › typefetch\.contracts — expected an object of contract modules, received undefined/,
      );
    });

    it("names the bad lint rule, not just 'invalid config'", async () => {
      await write(
        "typewire.config.ts",
        `export default {
           lint: { rules: { "path-params-declared": "fatal" } },
           typefetch: { contracts: {} },
         };`,
      );

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /lint\.rules\["path-params-declared"\] — expected one of off \| warn \| error, received the string "fatal"/,
      );
    });

    it("rejects an unknown diff.failOn", async () => {
      await write(
        "typewire.config.ts",
        `export default { diff: { failOn: "sometimes" }, typefetch: { contracts: {} } };`,
      );

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /diff\.failOn — expected one of none \| breaking \| any/,
      );
    });

    it("rejects a createClient that is not a function", async () => {
      await write(
        "typewire.config.ts",
        `export default { typefetch: { contracts: {}, createClient: "./client.ts" } };`,
      );

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /typefetch\.createClient — expected a function, received the string/,
      );
    });

    it("rejects a config with no sections at all", async () => {
      await write("typewire.config.ts", `export default { lint: { rules: {} } };`);

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /declares no package sections/,
      );
    });

    it("suggests the right spelling for a mistyped section", async () => {
      await write(
        "typewire.config.ts",
        `export default { typeFetch: { contracts: {} }, typesocket: {} };`,
      );

      await loadTypeWireConfig({ cwd: root, onWarn });

      expect(warnings.join("\n")).toMatch(/Unknown top-level key "typeFetch"[\s\S]*Did you mean "typefetch"\?/);
    });

    it("rejects a config that exports nothing usable", async () => {
      await write("typewire.config.ts", `export default 42;`);

      await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
        /exported 42\. Export an object, or a function returning one/,
      );
    });
  });

  describe("per-command requirements", () => {
    const section = { contracts: {}, test: {} } as ResolvedTypeFetchSection;

    it("lets a contracts-only command run without a client", async () => {
      await write(
        "typewire.config.ts",
        `export default { typefetch: { contracts: ${CONTRACTS} } };`,
      );

      // The whole point of moving the client requirement out of the loader:
      // linting a contract file must not need a live API.
      const config = await loadTypeWireConfig({ cwd: root, onWarn });
      expect(requireTypeFetch(config, "lint").contracts).toHaveProperty("user");
    });

    it("names the command that needs a client", async () => {
      await expect(
        resolveTypeFetchClient(section, "test", {}, "/repo/typewire.config.ts"),
      ).rejects.toThrow(/"test" makes real requests[\s\S]*createClient/);
    });

    it("names the command that needs the section", async () => {
      const config = {
        path: "/repo/typewire.config.ts",
        sources: [],
        legacy: false,
        lint: {},
        diff: {},
        projects: [
          { name: "default", implicit: true, lint: {}, diff: {} },
        ],
      };

      expect(() => requireTypeFetch(config, "list")).toThrow(
        /"list" needs a "typefetch" section/,
      );
    });

    it("passes --base-url and --token to createClient", async () => {
      const createClient = jest.fn(() => ({ modules: {} }));

      await resolveTypeFetchClient(
        { contracts: {}, test: {}, createClient } as unknown as ResolvedTypeFetchSection,
        "test",
        { baseUrl: "https://api.test", token: "t" },
        "/repo/typewire.config.ts",
      );

      expect(createClient).toHaveBeenCalledWith({
        baseUrl: "https://api.test",
        token: "t",
      });
    });
  });
});

describe("mergeConfig", () => {
  it("replaces arrays instead of concatenating them", () => {
    // A base listing every format must be overridable down to one; a
    // concatenating merge makes that impossible to express.
    const merged = mergeConfig(
      { report: { formats: ["markdown", "json", "html"] } },
      { report: { formats: ["json"] } },
    );

    expect(merged.report.formats).toEqual(["json"]);
  });

  it("never walks into a class instance", () => {
    class Schema {
      constructor(readonly shape: string) {}
    }

    const merged = mergeConfig(
      { schema: new Schema("base") },
      { schema: new Schema("override") },
    );

    expect(merged.schema).toBeInstanceOf(Schema);
    expect(merged.schema.shape).toBe("override");
  });

  it("ignores an explicit undefined in the override", () => {
    const merged = mergeConfig<{ a?: number; b?: number }>(
      { a: 1, b: 2 },
      { b: undefined },
    );

    expect(merged).toEqual({ a: 1, b: 2 });
  });
});

describe("parseJsonc", () => {
  it("reads the tsconfig people actually write", () => {
    expect(
      parseJsonc(`{
        // a line comment
        "compilerOptions": {
          /* a block comment */
          "baseUrl": ".",
          "paths": { "@/*": ["./src/*"] },
        },
      }`),
    ).toEqual({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
  });

  it("leaves comment-like text inside strings alone", () => {
    expect(parseJsonc(`{ "url": "https://x.dev/a", "re": "a/*b" }`)).toEqual({
      url: "https://x.dev/a",
      re: "a/*b",
    });
  });
});

describe("readTsconfigAliases", () => {
  it("follows the extends chain, because monorepos put paths in the base", async () => {
    await write(
      "tsconfig.base.json",
      `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }`,
    );
    await write(
      "app/tsconfig.json",
      `{ "extends": "../tsconfig.base.json", "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }`,
    );

    const aliases = await readTsconfigAliases(join(root, "app"));

    // Both resolve against the inherited baseUrl, which is TypeScript's own
    // rule: `paths` are relative to `baseUrl` wherever `baseUrl` was declared.
    // `~` landing in `app/lib` would be this loader disagreeing with tsc.
    expect(aliases["@"]).toBe(join(root, "src"));
    expect(aliases["~"]).toBe(join(root, "lib"));
  });

  it("resolves paths against the declaring file when there is no baseUrl", async () => {
    await write(
      "app/tsconfig.json",
      `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
    );

    const aliases = await readTsconfigAliases(join(root, "app"));

    expect(aliases["@"]).toBe(join(root, "app", "src"));
  });

  it("finds the tsconfig by walking up, like the config itself", async () => {
    await write(
      "tsconfig.json",
      `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
    );
    await mkdir(join(root, "a", "b"), { recursive: true });

    await expect(readTsconfigAliases(join(root, "a", "b"))).resolves.toEqual({
      "@": join(root, "src"),
    });
  });

  it("returns nothing rather than throwing when there is no tsconfig", async () => {
    await expect(readTsconfigAliases(root)).resolves.toEqual({});
  });
});

describe("typefetch.transports", () => {
  const adapter = (kind: string) => ({ kind, apiVersion: 1, describe: () => ({}) });

  it("is carried through for the commands that never build a client", async () => {
    await write(
      "typewire.config.ts",
      `export default {
         typefetch: {
           contracts: ${CONTRACTS},
           transports: [{ kind: "grpc", apiVersion: 1 }],
         },
       };`,
    );

    const config = await loadTypeWireConfig({ cwd: root, onWarn });

    expect(config.typefetch?.transports).toHaveLength(1);
    expect(config.typefetch?.transports?.[0]?.kind).toBe("grpc");
  });

  it("catches the adapter passed as a factory rather than its result", async () => {
    await write(
      "typewire.config.ts",
      `const grpcTransport = () => ({ kind: "grpc", apiVersion: 1 });
       export default { typefetch: { contracts: {}, transports: [grpcTransport] } };`,
    );

    // `transports: [grpcTransport]` instead of `[grpcTransport()]` is the
    // mistake this shape invites, and it would otherwise surface as a silent
    // `?` in a listing.
    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /typefetch\.transports\[0\] — received a function — call it, e\.g\. grpcTransport\(\)/,
    );
  });

  it("rejects a non-array", async () => {
    await write(
      "typewire.config.ts",
      `export default { typefetch: { contracts: {}, transports: { grpc: true } } };`,
    );

    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /typefetch\.transports — expected an array of transport adapters/,
    );
  });

  it("rejects an entry that is not an adapter", async () => {
    await write(
      "typewire.config.ts",
      `export default { typefetch: { contracts: {}, transports: ["grpc"] } };`,
    );

    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /typefetch\.transports\[0\] — expected a transport adapter, received the string "grpc"/,
    );
  });

  it("merges through extends like everything else", async () => {
    await write(
      "base.config.ts",
      `export default { typefetch: { contracts: {}, transports: [{ kind: "grpc", apiVersion: 1 }] } };`,
    );
    await write(
      "typewire.config.ts",
      `export default { extends: "./base.config.ts", typefetch: { contracts: ${CONTRACTS} } };`,
    );

    const config = await loadTypeWireConfig({ cwd: root, onWarn });
    expect(config.typefetch?.transports?.[0]?.kind).toBe("grpc");
  });

  it("is not required — the degrade path still works", async () => {
    await write(
      "typewire.config.ts",
      `export default { typefetch: { contracts: ${CONTRACTS} } };`,
    );

    const config = await loadTypeWireConfig({ cwd: root, onWarn });
    expect(config.typefetch?.transports).toBeUndefined();
    void adapter;
  });
});

describe("projects — several API surfaces in one repo", () => {
  const THREE = `export default {
    lint: { rules: { "path-params-declared": "error", "duplicate-id": "error" } },
    projects: {
      dashboard: { typefetch: { contracts: ${CONTRACTS} } },
      admin: {
        typefetch: { contracts: { admin: { ban: { method: "POST", path: "/ban" } } } },
        lint: { rules: { "duplicate-id": "off" } },
        diff: { baseline: "admin.lock.json" },
      },
      landing: { typefetch: { contracts: {} } },
    },
  };`;

  it("resolves one entry per named surface", async () => {
    await write("typewire.config.ts", THREE);

    const config = await loadTypeWireConfig({ cwd: root, onWarn });

    expect(config.projects.map((p) => p.name)).toEqual([
      "dashboard",
      "admin",
      "landing",
    ]);
    expect(config.projects.every((p) => p.implicit)).toBe(false);
  });

  it("gives a single-API config one implicit project, so commands never branch", async () => {
    await write(
      "typewire.config.ts",
      `export default { typefetch: { contracts: ${CONTRACTS} } };`,
    );

    const config = await loadTypeWireConfig({ cwd: root, onWarn });

    expect(config.projects).toHaveLength(1);
    expect(config.projects[0]).toMatchObject({ name: "default", implicit: true });
    // …and the convenience accessor still points at it.
    expect(config.typefetch?.contracts).toHaveProperty("user.getUser");
  });

  it("inherits shared lint rules and lets a project override one", async () => {
    await write("typewire.config.ts", THREE);

    const config = await loadTypeWireConfig({ cwd: root, onWarn });
    const byName = Object.fromEntries(config.projects.map((p) => [p.name, p]));

    expect(byName.dashboard?.lint.rules).toEqual({
      "path-params-declared": "error",
      "duplicate-id": "error",
    });
    // Overridden key by key, not replaced wholesale.
    expect(byName.admin?.lint.rules).toEqual({
      "path-params-declared": "error",
      "duplicate-id": "off",
    });
    expect(byName.admin?.diff.baseline).toBe("admin.lock.json");
  });

  it("refuses to guess which project a command means", async () => {
    await write("typewire.config.ts", THREE);

    const config = await loadTypeWireConfig({ cwd: root, onWarn });

    // Silently picking the first would test one API and report on three.
    expect(config.typefetch).toBeUndefined();
    expect(() => requireTypeFetch(config, "test")).toThrow(
      /declares 3 projects \(dashboard, admin, landing\)[\s\S]*--project <name>/,
    );
  });

  it("selects all projects by default, and the named ones on request", async () => {
    await write("typewire.config.ts", THREE);
    const config = await loadTypeWireConfig({ cwd: root, onWarn });

    expect(selectProjects(config)).toHaveLength(3);
    expect(selectProjects(config, ["admin"]).map((p) => p.name)).toEqual(["admin"]);
    expect(selectProjects(config, ["admin", "landing"])).toHaveLength(2);
  });

  it("lists what exists when --project names something that does not", async () => {
    await write("typewire.config.ts", THREE);
    const config = await loadTypeWireConfig({ cwd: root, onWarn });

    expect(() => selectProjects(config, ["admn"])).toThrow(
      /No project named "admn"[\s\S]*Available: dashboard, admin, landing/,
    );
  });

  it("refuses sections at the top level alongside projects", async () => {
    await write(
      "typewire.config.ts",
      `export default {
         typefetch: { contracts: ${CONTRACTS} },
         projects: { admin: { typefetch: { contracts: {} } } },
       };`,
    );

    // Which surface do the top-level contracts belong to? Guessing is worse
    // than refusing.
    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /declares "projects" and also a top-level "typefetch" section[\s\S]*Only "lint" and "diff"/,
    );
  });

  it("refuses nesting", async () => {
    await write(
      "typewire.config.ts",
      `export default {
         projects: {
           admin: { typefetch: { contracts: {} }, projects: { deeper: {} } },
         },
       };`,
    );

    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /projects\.admin\.projects — projects cannot nest/,
    );
  });

  it("names the project in a validation error", async () => {
    await write(
      "typewire.config.ts",
      `export default { projects: { admin: { typefetch: { createClient: 1 } } } };`,
    );

    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /projects\.admin\.typefetch\.contracts/,
    );
  });

  it("rejects an empty projects block", async () => {
    await write("typewire.config.ts", `export default { projects: {} };`);

    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /projects — is empty/,
    );
  });

  it("rejects a project with no sections", async () => {
    await write(
      "typewire.config.ts",
      `export default { projects: { admin: { diff: { baseline: "x" } } } };`,
    );

    await expect(loadTypeWireConfig({ cwd: root, onWarn })).rejects.toThrow(
      /projects\.admin — declares no package sections/,
    );
  });

  it("names the project when a command needs a client it does not have", async () => {
    await write("typewire.config.ts", THREE);
    const config = await loadTypeWireConfig({ cwd: root, onWarn });
    const landing = config.projects.find((p) => p.name === "landing")!;

    await expect(
      resolveTypeFetchClient(landing.typefetch!, "test", {}, config.path, landing),
    ).rejects.toThrow(/needs a client[\s\S]*project "landing"/);
  });

  it("merges projects through extends", async () => {
    await write(
      "base.config.ts",
      `export default {
         projects: {
           admin: { typefetch: { contracts: {}, test: { options: { timeout: 5000 } } } },
         },
       };`,
    );
    await write(
      "typewire.config.ts",
      `export default {
         extends: "./base.config.ts",
         projects: {
           admin: { typefetch: { contracts: ${CONTRACTS} } },
           landing: { typefetch: { contracts: {} } },
         },
       };`,
    );

    const config = await loadTypeWireConfig({ cwd: root, onWarn });
    const admin = config.projects.find((p) => p.name === "admin");

    expect(config.projects.map((p) => p.name).sort()).toEqual(["admin", "landing"]);
    expect(admin?.typefetch?.test.options).toEqual({ timeout: 5000 });
    expect(admin?.typefetch?.contracts).toHaveProperty("user.getUser");
  });
});
