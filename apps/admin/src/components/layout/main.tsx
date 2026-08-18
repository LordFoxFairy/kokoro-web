import { cn } from "@/lib/utils";

export function Main({ className, ...props }: React.ComponentProps<"main">) {
  return <main id="content" tabIndex={-1} className={cn("mx-auto w-full max-w-7xl px-4 py-6", className)} {...props} />;
}
