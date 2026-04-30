import { AuthForm } from "../_components/AuthForm";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#06090f] px-4 py-10 text-white">
      <AuthForm flow="signUp" />
    </main>
  );
}
