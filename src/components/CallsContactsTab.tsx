import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CallRecordsTable } from "@/components/CallRecordsTable";
import { CallStatsCards } from "@/components/CallStatsCards";
import { ContactsPanel } from "@/components/ContactsPanel";
import { Phone, Users } from "lucide-react";

interface CallsContactsTabProps {
  calls: any[];
  isLoading: boolean;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  extensionFilter: string;
  onExtensionFilterChange: (filter: string) => void;
  directionFilter: string;
  onDirectionFilterChange: (filter: string) => void;
  statusFilter: string;
  onStatusFilterChange: (filter: string) => void;
  allTimeStats?: any;
  todayStats?: any;
  statsLoading?: boolean;
  isViewer?: boolean;
}

export const CallsContactsTab = ({
  calls,
  isLoading,
  currentPage,
  totalPages,
  totalCount,
  onPageChange,
  extensionFilter,
  onExtensionFilterChange,
  directionFilter,
  onDirectionFilterChange,
  statusFilter,
  onStatusFilterChange,
  allTimeStats,
  todayStats,
  statsLoading = false,
  isViewer = false,
}: CallsContactsTabProps) => {
  const [activeSubTab, setActiveSubTab] = useState("calls");

  return (
    <div className="w-full">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="calls" className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            Calls
          </TabsTrigger>
          <TabsTrigger value="contacts" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Contacts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calls" className="space-y-4">
          <CallStatsCards
            allTimeStats={allTimeStats}
            todayStats={todayStats}
            isLoading={statsLoading}
          />
          <CallRecordsTable
            calls={calls}
            isLoading={isLoading}
            currentPage={currentPage}
            totalPages={totalPages}
            totalCount={totalCount}
            onPageChange={onPageChange}
            extensionFilter={extensionFilter}
            onExtensionFilterChange={onExtensionFilterChange}
            directionFilter={directionFilter}
            onDirectionFilterChange={onDirectionFilterChange}
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
            isViewer={isViewer}
          />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};
