import { parseCliArgs } from "../cli/parse-args";

describe("TypeFetch CLI", () => {
  describe("parseCliArgs", () => {
    it("uses test as the default command", () => {
      expect(parseCliArgs([])).toEqual({
        command: "test",
        flags: {},
        positionals: [],
        raw: [],
      });
    });

    it("parses the test command with common flags", () => {
      const parsed = parseCliArgs([
        "test",
        "--config",
        "./typefetch.test.config.ts",
        "--mode",
        "full",
        "--include-tags",
        "smoke,user",
        "--exclude-tags=danger",
        "--include-destructive",
        "--no-stop-on-fail",
        "--format",
        "markdown,json,html",
        "--output",
        "./typefetch-report/report",
      ]);

      expect(parsed.command).toBe("test");
      expect(parsed.flags).toMatchObject({
        config: "./typefetch.test.config.ts",
        mode: "full",
        includeTags: "smoke,user",
        excludeTags: "danger",
        includeDestructive: true,
        stopOnFail: false,
        format: "markdown,json,html",
        output: "./typefetch-report/report",
      });
    });

    it("parses short aliases", () => {
      const parsed = parseCliArgs([
        "test",
        "-c",
        "./config.ts",
        "-m",
        "live",
        "-f",
        "json",
        "-o",
        "./report",
      ]);

      expect(parsed.flags).toMatchObject({
        config: "./config.ts",
        mode: "live",
        format: "json",
        output: "./report",
      });
    });

    it("switches to help and version commands from flags", () => {
      expect(parseCliArgs(["--help"]).command).toBe("help");
      expect(parseCliArgs(["--version"]).command).toBe("version");
    });

    it("parses release-doc positional version", () => {
      const parsed = parseCliArgs(["release-doc", "v1.6.0", "--title", "Testing Feature"]);

      expect(parsed.command).toBe("release-doc");
      expect(parsed.positionals).toEqual(["v1.6.0"]);
      expect(parsed.flags.title).toBe("Testing Feature");
    });
  });
});
