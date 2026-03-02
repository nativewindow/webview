import { Inter } from "next/font/google";
import { Provider } from "@/components/provider";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <div className="bg-amber-500/15 text-amber-700 dark:text-amber-400 text-center text-sm py-2 px-4 font-medium">
          This project is in alpha — APIs may change without notice.
        </div>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
