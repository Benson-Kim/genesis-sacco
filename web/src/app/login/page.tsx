import type { Metadata } from "next";
import { LoginGate } from "@/modules/auth/components/LoginGate";

export const metadata: Metadata = {
  title: "Sign in · Genesis Prestige Admin",
};

export default function LoginPage() {
  return <LoginGate />;
}
