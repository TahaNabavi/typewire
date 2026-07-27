import { QueryClient } from "@tahanabavi/typefetch-query-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { TypeFetchProvider, useQueryClient } from "../context";
import { useMutation } from "../use-mutation";
import { useQuery } from "../use-query";
import { deferred, makeEndpoint } from "./helpers";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children?: ReactNode }) {
    return <TypeFetchProvider client={client}>{children}</TypeFetchProvider>;
  };
}

describe("TypeFetchProvider / useQueryClient", () => {
  it("provides the client to the tree", () => {
    const client = new QueryClient();
    function Probe() {
      return <span data-testid="same">{String(useQueryClient() === client)}</span>;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    expect(screen.getByTestId("same")).toHaveTextContent("true");
  });

  it("throws a useful error when the provider is missing", () => {
    function Probe() {
      useQueryClient();
      return null;
    }
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/No QueryClient found/);

    spy.mockRestore();
  });
});

describe("useQuery", () => {
  it("moves from loading to data", async () => {
    const client = new QueryClient();
    const gate = deferred<{ name: string }>();
    const endpoint = makeEndpoint("user.getUser", () => gate.promise);
    function Probe() {
      const { data, isLoading } = useQuery(endpoint, { id: "1" });
      return <span data-testid="out">{isLoading ? "loading" : data?.name}</span>;
    }

    render(<Probe />, { wrapper: wrapper(client) });
    expect(screen.getByTestId("out")).toHaveTextContent("loading");

    gate.resolve({ name: "Taha" });

    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("Taha"));
  });

  it("shares one request between two components on the same key", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.getUser", async () => ({ name: "Taha" }));
    function Probe({ id }: { id: string }) {
      const { data } = useQuery(endpoint, { id: "1" });
      return <span data-testid={id}>{data?.name ?? "-"}</span>;
    }

    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("Taha"));
    expect(screen.getByTestId("b")).toHaveTextContent("Taha");
    expect(endpoint.calls).toHaveLength(1);
  });

  it("does not fetch when disabled", () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.getUser", async () => ({ name: "Taha" }));
    function Probe() {
      const { status } = useQuery(endpoint, { id: "1" }, { enabled: false });
      return <span data-testid="out">{status}</span>;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    expect(screen.getByTestId("out")).toHaveTextContent("pending");
    expect(endpoint.calls).toHaveLength(0);
  });

  it("projects data through select", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.getUser", async () => ({
      id: "1",
      name: "Taha",
    }));
    function Probe() {
      const { data } = useQuery(endpoint, { id: "1" }, {
        select: (user) => user.name.toUpperCase(),
      });
      return <span data-testid="out">{data ?? "-"}</span>;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("TAHA"));
  });

  it("surfaces an error without throwing", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.getUser", async () => {
      throw new Error("boom");
    });
    function Probe() {
      const { isError, error } = useQuery(endpoint, { id: "1" });
      return <span data-testid="out">{isError ? error?.message : "-"}</span>;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("boom"));
  });

  describe("changing input", () => {
    it("refetches and shows the new input's data", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint(
        "user.getUser",
        async (input: { id: string }) => ({ name: `user-${input.id}` }),
      );
      function Probe() {
        const [id, setId] = useState("1");
        const { data } = useQuery(endpoint, { id });
        return (
          <button type="button" data-testid="out" onClick={() => setId("2")}>
            {data?.name ?? "-"}
          </button>
        );
      }

      render(<Probe />, { wrapper: wrapper(client) });
      await waitFor(() =>
        expect(screen.getByTestId("out")).toHaveTextContent("user-1"),
      );

      fireEvent.click(screen.getByTestId("out"));

      await waitFor(() =>
        expect(screen.getByTestId("out")).toHaveTextContent("user-2"),
      );
      expect(endpoint.calls).toEqual([{ id: "1" }, { id: "2" }]);
    });

    it("never shows the previous input's data after the switch", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint(
        "user.getUser",
        async (input: { id: string }) => ({ name: `user-${input.id}` }),
      );
      const seen: string[] = [];
      function Probe() {
        const [id, setId] = useState("1");
        const { data } = useQuery(endpoint, { id });
        // Record what each render would paint for the *current* id.
        seen.push(`${id}:${data?.name ?? "none"}`);
        return (
          <button type="button" data-testid="out" onClick={() => setId("2")}>
            {data?.name ?? "-"}
          </button>
        );
      }

      render(<Probe />, { wrapper: wrapper(client) });
      await waitFor(() =>
        expect(screen.getByTestId("out")).toHaveTextContent("user-1"),
      );
      seen.length = 0;

      fireEvent.click(screen.getByTestId("out"));
      await waitFor(() =>
        expect(screen.getByTestId("out")).toHaveTextContent("user-2"),
      );

      // Rebinding happens during render, so no frame pairs id 2 with user-1.
      expect(seen).not.toContain("2:user-1");
    });
  });

  it("releases the query when the component unmounts", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.getUser", async () => ({ name: "Taha" }));
    function Probe() {
      const { data } = useQuery(endpoint, { id: "1" });
      return <span data-testid="out">{data?.name ?? "-"}</span>;
    }

    const view = render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("Taha"));
    const query = client.cache.find({ endpointId: "user.getUser" })[0];
    expect(query?.getObserverCount()).toBe(1);

    view.unmount();

    expect(query?.getObserverCount()).toBe(0);
  });
});

describe("useMutation", () => {
  it("runs the write and exposes the result", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));
    function Probe() {
      const { mutate, isPending, data } = useMutation(endpoint);
      return (
        <button type="button" data-testid="out" onClick={() => mutate({ id: "1" })}>
          {isPending ? "saving" : String(data?.ok ?? "-")}
        </button>
      );
    }

    render(<Probe />, { wrapper: wrapper(client) });
    expect(screen.getByTestId("out")).toHaveTextContent("-");

    fireEvent.click(screen.getByTestId("out"));

    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("true"));
  });

  it("reports a failure without an unhandled rejection", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => {
      throw new Error("boom");
    });
    function Probe() {
      const { mutate, error } = useMutation(endpoint);
      return (
        <button type="button" data-testid="out" onClick={() => mutate({ id: "1" })}>
          {error?.message ?? "-"}
        </button>
      );
    }

    render(<Probe />, { wrapper: wrapper(client) });
    fireEvent.click(screen.getByTestId("out"));

    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("boom"));
  });

  it("uses the latest onSuccess rather than the first render's", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));
    const calls: number[] = [];
    function Probe() {
      const [tick, setTick] = useState(0);
      const { mutate } = useMutation(endpoint, {
        onSuccess: () => calls.push(tick),
      });
      return (
        <>
          <button type="button" data-testid="tick" onClick={() => setTick(1)} />
          <button
            type="button"
            data-testid="save"
            onClick={() => mutate({ id: "1" })}
          />
        </>
      );
    }

    render(<Probe />, { wrapper: wrapper(client) });
    fireEvent.click(screen.getByTestId("tick"));
    fireEvent.click(screen.getByTestId("save"));

    await waitFor(() => expect(calls).toEqual([1]));
  });

  it("refetches a related query through declared relations", async () => {
    const client = new QueryClient({
      relations: { "user.updateUser": ["user.getUser"] },
    });
    let version = 0;
    const getUser = makeEndpoint("user.getUser", async () => {
      version += 1;
      return { name: `v${version}` };
    });
    const updateUser = makeEndpoint("user.updateUser", async () => ({ ok: true }));
    function Probe() {
      const { data } = useQuery(getUser, { id: "1" }, { staleTime: 60_000 });
      const { mutate } = useMutation(updateUser);
      return (
        <button type="button" data-testid="out" onClick={() => mutate({ id: "1" })}>
          {data?.name ?? "-"}
        </button>
      );
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("v1"));

    fireEvent.click(screen.getByTestId("out"));

    // No cache key is named anywhere in this component — the relation did it.
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("v2"));
  });
});
