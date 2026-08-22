import { DocsHub, DOCS_DESCRIPTION } from "@/features/docs/hub";
import { pageMetadata } from "@/lib/seo";
import { PATHS } from "@/routes/paths";

export const metadata = pageMetadata({
  title: "Docs",
  description: DOCS_DESCRIPTION,
  path: PATHS.DOCS,
  keywords: ["TypeWire docs", "typed contract reference", "TypeScript API documentation"],
});

export default function Page() {
  return <DocsHub />;
}
