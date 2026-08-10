import { redirect } from "next/navigation";

// /login used to be the app's front door — now it's just a redirect so
// previously-distributed links (including tagged ?source= links) still
// work, but everyone lands on the real front door: the landing page at /.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const query = qs.toString();
  redirect(query ? `/?${query}` : "/");
}
