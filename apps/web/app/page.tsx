import { CommerceWorkbenchShell } from "@/components/shell/commerce-workbench-shell";

export default function HomePage() {
  return (
    <CommerceWorkbenchShell
      allowPublicRegistration={
        process.env.NODE_ENV !== "production" && process.env.COMMERCE_ALLOW_PUBLIC_REGISTRATION === "true"
      }
    />
  );
}
