import { Suspense } from "react";
import { StackHandler } from "@stackframe/stack";

export default function Handler() {
  return (
    <Suspense>
        <StackHandler fullPage />;
    </Suspense>
  );
}
