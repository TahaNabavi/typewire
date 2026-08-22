import type { Metadata } from "next";

import { AdminLoginPage } from "@/features/admin/login";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  return <AdminLoginPage searchParams={searchParams} />;
}
