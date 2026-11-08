import { AccountScreen } from "@/components/account-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Create account | Merova AI" };
export default function Page() {
  return (
    <AccountScreen
      signup={true}
      invited={Boolean(process.env.BUILDER_ACCESS_TOKEN?.trim())}
    />
  );
}
