import { redirect } from "next/navigation";

/**
 * The overview page only showed summary counts and two empty chart placeholders.
 * Sign-in still arrives here, so send people to Expenses, which is the working home.
 */
export default function DashboardPage() {
  redirect("/expenses");
}
