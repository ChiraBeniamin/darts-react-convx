import Link from "next/link";
import { AuthForm } from "../_components/AuthForm";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#06090f] px-4 py-10 text-white">
      <AuthForm flow="signIn" />
      <Link
        href="/"
        className="mt-8 text-sm text-zinc-500 underline-offset-4 hover:text-zinc-400 hover:underline"
      >
        ← Back to home
      </Link>
    </main>
  );
}
