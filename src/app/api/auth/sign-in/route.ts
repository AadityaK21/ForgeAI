import { authenticate } from "@/lib/account";
export async function POST(req: Request) {
  return authenticate(req, false);
}
