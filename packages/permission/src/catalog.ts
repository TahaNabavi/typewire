import type { Compiled } from "./compile";
import type { CatalogEntry } from "./types";

/**
 * The flags as flat rows, in declaration order — the source for a
 * permission-management UI (a role editor's checkbox grid). `hidden` flags are
 * omitted (still enforced everywhere); `requires`/`implies` let the UI grey out
 * or auto-tick dependent boxes. Serializes to JSON, so a non-JS admin panel
 * renders the same screen from the same source.
 */
export function catalog(compiled: Compiled): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const flag of compiled.byName.values()) {
    if (flag.def.hidden) continue;
    const entry: CatalogEntry = {
      name: flag.name,
      module: flag.module,
      member: flag.member,
      bit: flag.bit,
      grantsAll: flag.def.grantsAll === true,
      deprecated: flag.def.deprecated === true,
    };
    if (flag.def.label !== undefined) entry.label = flag.def.label;
    if (flag.def.description !== undefined) entry.description = flag.def.description;
    if (flag.def.implies?.length) entry.implies = [...flag.def.implies];
    if (flag.def.requires?.length) entry.requires = [...flag.def.requires];
    out.push(entry);
  }
  return out;
}
