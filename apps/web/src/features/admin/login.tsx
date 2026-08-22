import { Container } from "@/components/ui/container";
import { Panel } from "@/components/ui/panel";
import { adminConfigured } from "@/features/admin/auth";
import { PATHS } from "@/routes/paths";

export async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const configured = adminConfigured();

  return (
    <Container className="flex min-h-[70vh] max-w-md items-center py-16">
      <Panel className="w-full">
        <h1 className="text-xl font-bold text-fg">Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">One password, one operator.</p>

        {!configured && (
          <p className="mt-5 rounded-lg border border-dashed border-amber/40 bg-amber/10 p-3 text-sm text-amber">
            ADMIN_PASSWORD and ADMIN_SECRET are not set on this deployment, so sign-in is disabled.
          </p>
        )}

        <form action="/api/admin/login" method="post" className="mt-6">
          <input type="hidden" name="next" value={next ?? PATHS.ADMIN} />
          <label className="block">
            <span className="font-mono text-[11px] uppercase tracking-wider text-dim">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              className="mt-1.5 w-full rounded-lg border border-hair bg-canvas px-3 py-2 text-sm text-fg"
            />
          </label>

          {error && <p className="mt-3 text-sm text-red">Wrong password.</p>}

          <button
            type="submit"
            disabled={!configured}
            className="mt-5 w-full rounded-lg bg-linear-to-r from-blue-strong to-purple-strong px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Sign in
          </button>
        </form>
      </Panel>
    </Container>
  );
}
