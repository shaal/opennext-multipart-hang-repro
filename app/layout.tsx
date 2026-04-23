export const metadata = {
  title: "OpenNext multipart hang repro",
  description: "Minimal reproduction for opennextjs/opennextjs-cloudflare#1224",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
