import { useQuery } from "@tanstack/react-query";
import { mirrorGet } from "~~/utils/sanad/mirror";

/**
 * A mirror node route as a React Query, keyed by the route so screens that ask for the same thing
 * share one request. `data` is null when the entity does not exist. Pass no route to wait.
 */
export const useMirror = <T>(route: string | undefined, refetchInterval?: number) =>
  useQuery({
    queryKey: ["mirror", route],
    queryFn: () => mirrorGet<T>(route as string),
    enabled: route !== undefined,
    refetchInterval,
  });
