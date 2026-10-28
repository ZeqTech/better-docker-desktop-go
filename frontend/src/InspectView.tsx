import { api } from "./api";
import { useData } from "./ui";

export function InspectView({ kind, target }: { kind: "container" | "image" | "volume"; target: string }) {
  const { data, error, loading } = useData(() => api.inspect(kind, target));
  return <pre className={`logbox${error ? " err" : ""}`}>{error ?? (loading ? "Loading…" : data)}</pre>;
}
