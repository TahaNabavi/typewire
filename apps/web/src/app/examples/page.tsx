import { ExamplesPage, EXAMPLES_DESCRIPTION } from "@/features/examples";
import { pageMetadata } from "@/lib/seo";
import { PATHS } from "@/routes/paths";

export const metadata = pageMetadata({
  title: "Examples",
  description: EXAMPLES_DESCRIPTION,
  path: PATHS.EXAMPLES,
  keywords: ["TypeWire examples", "typed API example", "TypeScript contract demo"],
});

export default function Page() {
  return <ExamplesPage />;
}
