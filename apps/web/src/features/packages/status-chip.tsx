import { Chip } from "@/components/ui/chip";

/** Published version, or the honest "built, not yet published" state. */
export function StatusChip({
  published,
  version,
  pending,
}: {
  published: boolean;
  version: string | null;
  pending?: string | null;
}) {
  if (!published) {
    return (
      <Chip tone="var(--amber)" dashed>
        UNPUBLISHED
      </Chip>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Chip tone="var(--green)">v{version}</Chip>
      {pending && <Chip tone="var(--dim)" dashed>{`v${pending} pending`}</Chip>}
    </span>
  );
}
