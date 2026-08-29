import { Chip } from "@/components/ui/chip";
import { TRANSPORT_LABEL, TRANSPORT_TOKEN, type Transport } from "@/lib/registry";

/**
 * A wire always gets the same colour — and always carries its label too, so
 * colour is never the only signal.
 */
export function TransportBadge({ transport }: { transport: Transport }) {
  return (
    <Chip tone={TRANSPORT_TOKEN[transport]}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: TRANSPORT_TOKEN[transport] }}
      />
      {TRANSPORT_LABEL[transport]}
    </Chip>
  );
}
