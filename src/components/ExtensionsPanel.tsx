import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Phone, PhoneOff, User, Settings, Clock, ArrowLeft, PhoneCall, Eye, Filter, Search, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDateNairobi } from '@/lib/dateUtils';

interface Extension {
  id: string;
  extnumber: string;
  username: string;
  status: string;
  type: string;
  callerid: string;
  registername: string;
  mobile?: string;
  email?: string;
  language: string;
  hasvoicemail: string;
  alwaysforward: string;
  noanswerforward: string;
  busyforward: string;
  ringtimeout: string;
  outroute: string;
  dnd: string;
  nat: string;
  last_synced: string;
  created_at: string;
  updated_at: string;
}

interface ExtensionStats {
  total: number;
  registered: number;
  unavailable: number;
  offline: number;
}

interface ExtensionsData {
  extensions: Extension[];
  stats: ExtensionStats;
}

interface CallLog {
  id: string;
  caller_number: string;
  callee_number: string;
  direction: string;
  status: string;
  start_time: string;
  duration: number;
  recording_url?: string;
}

interface ApiEndpoint {
  endpoint: string;
  version: string;
  type: string;
  status: string;
  error?: string;
  dataCount: number;
}

const ExtensionsPanel: React.FC = () => {
  const [extensionsData, setExtensionsData] = useState<ExtensionsData | null>(null);
  const [selectedExtension, setSelectedExtension] = useState<Extension | null>(null);
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);
  const [filteredExtensions, setFilteredExtensions] = useState<Extension[]>([]);
  const [extensionFilter, setExtensionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [extensionCallLogs, setExtensionCallLogs] = useState<CallLog[]>([]);
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingCallLogs, setLoadingCallLogs] = useState(false);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchExtensions = async () => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/extensions`);
      const data = await response.json();
      
      if (data.success) {
        setExtensionsData(data.data);
      } else {
        setError(data.error || 'Failed to fetch extensions');
      }
    } catch (err) {
      setError('Failed to connect to API server');
      console.error('Extensions fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const syncExtensions = async () => {
    setSyncing(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/pbx-sync-extensions`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: "Sync Successful",
          description: data.message,
        });
        // Refresh the extensions list
        await fetchExtensions();
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sync failed';
      setError(errorMessage);
      toast({
        title: "Sync Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const fetchExtensionCallLogs = async (extnumber: string) => {
    setLoadingCallLogs(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/extensions/${extnumber}/call-logs?page=1&pageSize=100`);
      const data = await response.json();
      
      if (data.success) {
        setExtensionCallLogs(data.data || []);
      } else {
        setExtensionCallLogs([]);
        console.log('No call logs found for extension:', extnumber);
      }
    } catch (err) {
      console.error('Error fetching call logs:', err);
      setExtensionCallLogs([]);
    } finally {
      setLoadingCallLogs(false);
    }
  };

  const selectExtension = (extension: Extension) => {
    setSelectedExtension(extension);
    setSelectedExtensionId(extension.id);
    fetchExtensionCallLogs(extension.extnumber);
  };

  const goBackToList = () => {
    setSelectedExtension(null);
    setSelectedExtensionId(null);
    setExtensionCallLogs([]);
  };

  const fetchApiEndpoints = async () => {
    setLoadingEndpoints(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL;
      const response = await fetch(`${apiUrl}/api/pbx-endpoints`);
      const data = await response.json();
      
      if (data.success) {
        setApiEndpoints(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching API endpoints:', err);
    } finally {
      setLoadingEndpoints(false);
    }
  };

  const filterExtensions = (extensions: Extension[]) => {
    let filtered = extensions;
    
    // Filter by search query (extension number or name)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(ext => 
        ext.extnumber.toLowerCase().includes(query) ||
        ext.username.toLowerCase().includes(query)
      );
    }
    
    // Filter by extension selection
    if (extensionFilter !== 'all') {
      filtered = filtered.filter(ext => ext.extnumber === extensionFilter);
    }
    
    return filtered;
  };

  useEffect(() => {
    if (extensionsData) {
      setFilteredExtensions(filterExtensions(extensionsData.extensions));
    }
  }, [extensionsData, searchQuery, extensionFilter]);

  useEffect(() => {
    fetchExtensions();
    fetchApiEndpoints();
    
    // Auto-sync extensions every 12 hours (43200000 ms)
    const syncInterval = setInterval(() => {
      syncExtensions();
    }, 12 * 60 * 60 * 1000);
    
    return () => clearInterval(syncInterval);
  }, []);

  const getStatusBadgeVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case 'registered':
        return 'default';
      case 'unavailable':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'registered':
        return <Phone className="h-4 w-4 text-green-500" />;
      case 'unavailable':
        return <PhoneOff className="h-4 w-4 text-gray-500" />;
      default:
        return <PhoneOff className="h-4 w-4 text-red-500" />;
    }
  };

  const formatDate = (dateString: string) => {
    return formatDateNairobi(dateString);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span>Loading extensions...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={fetchExtensions} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // If extension is selected, show detailed view
  if (selectedExtension) {
    return (
      <div className="space-y-6">
        {/* Extension Detail Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button onClick={goBackToList} variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Extensions
            </Button>
            <div className="flex items-center space-x-2">
              {getStatusIcon(selectedExtension.status)}
              <span className="text-2xl font-bold">{selectedExtension.extnumber}</span>
              <Badge variant={getStatusBadgeVariant(selectedExtension.status)}>
                {selectedExtension.status}
              </Badge>
            </div>
          </div>
          <Button 
            onClick={() => fetchExtensionCallLogs(selectedExtension.extnumber)}
            disabled={loadingCallLogs}
            size="sm"
          >
            {loadingCallLogs ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Call Logs
          </Button>
        </div>

        {/* Extension Details Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <User className="h-5 w-5" />
                <span>Extension Details</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Name</p>
                  <p className="font-semibold">{selectedExtension.username}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Caller ID</p>
                  <p className="font-semibold">{selectedExtension.callerid}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Type</p>
                  <p>{selectedExtension.type}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Route</p>
                  <p>{selectedExtension.outroute}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Ring Timeout</p>
                  <p>{selectedExtension.ringtimeout}s</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Language</p>
                  <p>{selectedExtension.language}</p>
                </div>
              </div>
              
              <Separator />
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">DND</p>
                  <Badge variant={selectedExtension.dnd === 'on' ? 'destructive' : 'secondary'}>
                    {selectedExtension.dnd === 'on' ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Voicemail</p>
                  <Badge variant={selectedExtension.hasvoicemail === 'on' ? 'default' : 'secondary'}>
                    {selectedExtension.hasvoicemail === 'on' ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </div>
              
              <div className="text-xs text-muted-foreground mt-4">
                <p>Last synced: {formatDate(selectedExtension.last_synced)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Call Logs Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <PhoneCall className="h-5 w-5" />
                <span>Recent Call Logs</span>
              </CardTitle>
              <CardDescription>
                Call history for extension {selectedExtension.extnumber}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCallLogs ? (
                <div className="flex items-center space-x-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Loading call logs...</span>
                </div>
              ) : extensionCallLogs.length > 0 ? (
                <div className="space-y-4">
                  {extensionCallLogs.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        {log.direction === 'inbound' ? (
                          <Phone className="h-4 w-4 text-green-500" />
                        ) : (
                          <Phone className="h-4 w-4 text-blue-500 rotate-45" />
                        )}
                        <div>
                          <p className="font-medium">
                            {log.direction === 'inbound' ? `From: ${log.caller_number}` : `To: ${log.callee_number}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(log.start_time)} • {log.duration}s • {log.status}
                          </p>
                        </div>
                      </div>
                      {log.recording_url && (
                        <Button size="sm" variant="outline">
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <PhoneCall className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Call Logs</h3>
                  <p className="text-muted-foreground">
                    No recent call activity found for this extension.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">PBX Extensions</h2>
          <p className="text-muted-foreground">
            Manage and monitor your PBX extension status
          </p>
        </div>
        <div className="flex space-x-2">
          <Button onClick={fetchExtensions} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button 
            onClick={syncExtensions} 
            disabled={syncing}
            size="sm"
          >
            {syncing ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Settings className="h-4 w-4 mr-2" />
            )}
            Sync from PBX
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {extensionsData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <User className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{extensionsData.stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Phone className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Registered</p>
                  <p className="text-2xl font-bold text-green-600">{extensionsData.stats.registered}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <PhoneOff className="h-5 w-5 text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Unavailable</p>
                  <p className="text-2xl font-bold text-gray-600">{extensionsData.stats.unavailable}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Last Sync</p>
                  <p className="text-sm font-medium">
                    {extensionsData.extensions.length > 0 
                      ? formatDate(extensionsData.extensions[0].last_synced)
                      : 'Never'
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Extensions List */}
      {extensionsData && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Extensions ({filteredExtensions.length})</CardTitle>
                <CardDescription>
                  Real-time status of PBX extensions from Yeastar S100
                </CardDescription>
              </div>
            </div>
            
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mt-4">
              <div className="flex-1">
                <Label htmlFor="search">Search Extensions</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    id="search"
                    placeholder="Search by number or name (e.g., 1000 or NOSTEQ)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <div className="sm:w-64">
                <Label htmlFor="filter">Filter by Extension</Label>
                <Select value={extensionFilter} onValueChange={setExtensionFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Extensions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Extensions</SelectItem>
                    {extensionsData.extensions.map((ext) => (
                      <SelectItem key={ext.id} value={ext.extnumber}>
                        {ext.extnumber} - {ext.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredExtensions.length > 0 ? (
                filteredExtensions.map((extension) => (
                  <div 
                    key={extension.id} 
                    className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedExtensionId === extension.id
                        ? 'bg-cyan-50 border-cyan-300 hover:bg-cyan-100'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => selectExtension(extension)}
                  >
                    <div className="flex items-center space-x-4">
                      {getStatusIcon(extension.status)}
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-lg">{extension.extnumber}</span>
                          <Badge variant={getStatusBadgeVariant(extension.status)}>
                            {extension.status}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">{extension.username}</p>
                        <p className="text-xs text-muted-foreground">Caller ID: {extension.callerid}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                          <span>Type: {extension.type}</span>
                          <span>Route: {extension.outroute}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-muted-foreground mt-1">
                          <span>DND: {extension.dnd === 'on' ? 'On' : 'Off'}</span>
                          <span>VM: {extension.hasvoicemail === 'on' ? 'On' : 'Off'}</span>
                        </div>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectExtension(extension);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <Filter className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Extensions Found</h3>
                  <p className="text-muted-foreground">
                    {searchQuery || extensionFilter !== 'all' 
                      ? 'No extensions match your current filters.'
                      : 'No extensions available. Click "Sync from PBX" to load extension data.'
                    }
                  </p>
                  {(searchQuery || extensionFilter !== 'all') && (
                    <Button 
                      onClick={() => {
                        setSearchQuery('');
                        setExtensionFilter('all');
                      }} 
                      variant="outline" 
                      className="mt-4"
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {extensionsData && extensionsData.extensions.length === 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <Phone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Extensions Found</h3>
              <p className="text-muted-foreground mb-4">
                Click "Sync from PBX" to fetch extension data from your Yeastar PBX system.
              </p>
              <Button onClick={syncExtensions} disabled={syncing}>
                {syncing ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Settings className="h-4 w-4 mr-2" />
                )}
                Sync from PBX
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ExtensionsPanel;