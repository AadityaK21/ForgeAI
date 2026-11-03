import { AccountScreen } from "@/components/account-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in | ForgeAI" };
export default function Page() {
  return (
    <AccountScreen
      signup={false}
      invited={Boolean(process.env.BUILDER_ACCESS_TOKEN?.trim())}
    />
  );
}
