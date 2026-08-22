import { PlaygroundPage } from "@/features/playground";
import { pageMetadata } from "@/lib/seo";
import { PATHS } from "@/routes/paths";

export const metadata = pageMetadata({
  title: "Playground",
  description:
    "A real TypeWire client and server, running in your browser — with a switch that breaks the server so you can watch runtime validation catch it.",
  path: PATHS.PLAYGROUND,
  keywords: ["TypeWire playground", "Zod runtime validation demo", "typed API sandbox"],
});

export default function Page() {
  return <PlaygroundPage />;
}
