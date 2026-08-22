import type { Metadata } from "next";

import { AdminPage } from "@/features/admin";

export const metadata: Metadata = { title: "Panel", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function Page() {
  return <AdminPage />;
}
