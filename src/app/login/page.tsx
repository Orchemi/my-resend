import { redirect } from "next/navigation";

// Compatibility redirect — admin login moved to /admin/login (issue #50).
export default function LegacyLoginPage(): never {
  redirect("/admin/login");
}
