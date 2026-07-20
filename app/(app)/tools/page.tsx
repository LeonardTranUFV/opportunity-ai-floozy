import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { WebsiteScannerForm } from "@/components/tools/website-scanner-form"

export default function ToolsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Tools</h2>
        <p className="text-muted-foreground">Extra AI utilities to help you win opportunities.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Website Scanner</CardTitle>
          <CardDescription>
            Analyze a prospect&apos;s website and generate an improvement report — useful for
            outreach to businesses with weak online presence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WebsiteScannerForm />
        </CardContent>
      </Card>
    </div>
  )
}
