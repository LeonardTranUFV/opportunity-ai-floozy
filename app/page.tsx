import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, Target, MessageSquare, DollarSign } from "lucide-react"

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Today's Opportunities</h2>
        <p className="text-muted-foreground">Here is your daily AI digest.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Intent Leads</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-muted-foreground">+2 from yesterday</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24</div>
            <p className="text-xs text-muted-foreground">+5 replies this morning</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Est. Opportunity Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$48,500</div>
            <p className="text-xs text-muted-foreground">+14% month over month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Communities Monitored</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">142</div>
            <p className="text-xs text-muted-foreground">3 new groups added</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
            <CardDescription>
              The AI has found new high-intent conversations matching your criteria.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  <Activity className="h-4 w-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Homeowner in Burnaby</p>
                  <p className="text-sm text-muted-foreground">
                    "My roof is leaking after the heavy rain yesterday. Looking for recommendations."
                  </p>
                </div>
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">High Intent</div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Local Restaurant</p>
                  <p className="text-sm text-muted-foreground">
                    "Does anyone know a good local web designer to redo our menu?"
                  </p>
                </div>
                <div className="text-sm font-medium text-amber-600 dark:text-amber-400">Medium Intent</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>AI Discovery Engine</CardTitle>
            <CardDescription>
              Recommended communities to monitor
            </CardDescription>
          </CardHeader>
          <CardContent>
             <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Vancouver Homeowners</p>
                  <p className="text-xs text-muted-foreground">
                    Facebook Group • 14k Members
                  </p>
                </div>
                <div className="text-xs border px-2 py-1 rounded-md font-medium text-muted-foreground hover:bg-accent cursor-pointer transition-colors">Join</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">r/VancouverHousing</p>
                  <p className="text-xs text-muted-foreground">
                    Reddit • 82k Members
                  </p>
                </div>
                <div className="text-xs border px-2 py-1 rounded-md font-medium text-muted-foreground hover:bg-accent cursor-pointer transition-colors">Join</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}