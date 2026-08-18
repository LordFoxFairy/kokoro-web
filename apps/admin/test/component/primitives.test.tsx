import { useForm } from "react-hook-form";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

describe("shadcn primitives", () => {
  it("renders native button semantics", () => {
    render(<Button type="submit">Save changes</Button>);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("type", "submit");
  });

  it("moves focus into a dialog and restores it to the trigger", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent><Button>Confirm</Button></DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes a sheet with Escape", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open navigation</SheetTrigger>
        <SheetContent>Navigation</SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("associates form errors with their input", async () => {
    function Example() {
      const form = useForm<{ email: string }>({ defaultValues: { email: "" } });
      return <Form {...form}><form onSubmit={form.handleSubmit(() => undefined)}>
        <FormField control={form.control} name="email" rules={{ required: "Email is required" }} render={({ field }) => <FormItem><FormControl><Input aria-label="Email" {...field} /></FormControl><FormMessage /></FormItem>} />
        <Button>Submit</Button>
      </form></Form>;
    }
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
  });

  it("exposes a tooltip label on keyboard focus", async () => {
    render(<TooltipProvider><Tooltip><TooltipTrigger asChild><button aria-label="Settings">S</button></TooltipTrigger><TooltipContent>Open settings</TooltipContent></Tooltip></TooltipProvider>);
    fireEvent.focus(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Open settings")).toBeInTheDocument();
  });

  it("opens and closes the mobile sidebar Sheet without using desktop state", async () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("matchMedia", matchMedia);
    render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar><nav aria-label="Primary">Mobile navigation</nav></Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    const sheet = await screen.findByRole("dialog", { name: "Sidebar" });
    expect(sheet).toHaveAttribute("data-mobile", "true");
    expect(screen.getByRole("navigation", { name: "Primary" })).toHaveTextContent("Mobile navigation");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    vi.unstubAllGlobals();
  });
});
