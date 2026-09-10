import NextLink from "next/link";
import type { ComponentProps } from "react";

type AppLinkProps = ComponentProps<typeof NextLink>;

/**
 * next/link with prefetching turned OFF by default.
 *
 * Next prefetches every <Link> that scrolls into view. Every route in this app
 * is dynamic and `staleTimes.dynamic` is 0 by client decision, so the router
 * cache throws each prefetched payload away and the click refetches from the
 * server regardless. The prefetch is therefore all cost and no benefit.
 *
 * Measured on 2026-09-10 against a local production build: one view of
 * /invoices fired 61 RSC requests, 32 of them full server renders of invoice
 * detail pages nobody opened, and the browser aborted almost all of them after
 * the server had already answered. On Vercel each one bills twice, once for the
 * proxy and once for the function.
 *
 * Pass `prefetch` explicitly to opt a specific link back in.
 */
export default function AppLink({ prefetch = false, ...props }: AppLinkProps) {
  return <NextLink prefetch={prefetch} {...props} />;
}
