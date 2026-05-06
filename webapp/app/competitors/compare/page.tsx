import { redirect } from "next/navigation";

// Compare moved into the main /competitors page as a tab. Preserve the old
// URL by redirecting and forwarding any ?ids= the user had bookmarked.
export default async function CompareRedirect({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("tab", "compare");
  if (sp.ids) qs.set("ids", sp.ids);
  redirect(`/competitors?${qs.toString()}`);
}
