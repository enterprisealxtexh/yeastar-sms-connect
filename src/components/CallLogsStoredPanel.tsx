import { useState, useMemo } from 'react';
import { useCallLogsStored } from '../hooks/useCallLogsStored';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { AlertCircle, Download, RotateCw, Phone, PhoneOff } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { formatDateNairobi } from '@/lib/dateUtils';

export function CallLogsStoredPanel() {
  const {
    logs,
    loading,
    error,
    total,
    page,
    limit,
    setPage,
    setLimit,
    fetchLogs,
    syncLogs,
    filterByDirection,
    filterByStatus,
    filterByExtension,
  } = useCallLogsStored();

  const [searchExtension, setSearchExtension] = useState('');
  const [filterDirection, setFilterDirection] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    const result = await syncLogs();
    if (result) {
      alert(`✅ Synced ${result.total} calls (${result.saved} saved, ${result.skipped} skipped)`);
    }
    setSyncing(false);
  };

  const handleFilterDirection = (value) => {
    setFilterDirection(value);
    if (value === 'all') {
      fetchLogs({ status: filterStatus !== 'all' ? filterStatus : undefined });
    } else {
      filterByDirection(value);
    }
  };

  const handleFilterStatus = (value) => {
    setFilterStatus(value);
    if (value === 'all') {
      fetchLogs({ direction: filterDirection !== 'all' ? filterDirection : undefined });
    } else {
      filterByStatus(value);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchExtension.trim()) {
      filterByExtension(searchExtension.trim());
    }
  };

  const totalPages = Math.ceil(total / limit);

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    try {
      return formatDateNairobi(timestamp);
    } catch {
      return timestamp;
    }
  };

  const getDirectionIcon = (direction) => {
    return direction === 'inbound' ? (
      <Phone className="w-4 h-4 text-blue-500" />
    ) : (
      <PhoneOff className="w-4 h-4 text-green-500" />
    );
  };

  const getStatusBadge = (status) => {
    const variants = {
      completed: 'bg-green-100 text-green-800',
      missed: 'bg-red-100 text-red-800',
      voicemail: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
      answered: 'bg-blue-100 text-blue-800',
    };
    return variants[status?.toLowerCase()] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-start mb-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              📋 All Call Logs ({total} total)
            </CardTitle>
            <CardDescription>
              Comprehensive call history stored locally
            </CardDescription>
          </div>
          <Button
            onClick={handleSync}
            disabled={syncing || loading}
            variant="outline"
            size="sm"
          >
            <RotateCw className="w-4 h-4 mr-2" />
            {syncing ? 'Syncing...' : 'Sync from PBX'}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Direction</label>
              <Select value={filterDirection} onValueChange={handleFilterDirection}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Directions</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={filterStatus} onValueChange={handleFilterStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="missed">Missed</SelectItem>
                  <SelectItem value="voicemail">Voicemail</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Extension</label>
              <Input
                placeholder="Search extension..."
                value={searchExtension}
                onChange={(e) => setSearchExtension(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch(e)}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Per Page</label>
              <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin text-2xl">⏳</div>
            <p className="text-gray-500 mt-2">Loading call logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No call logs found</p>
            <Button onClick={handleSync} variant="outline" size="sm" className="mt-4">
              <RotateCw className="w-4 h-4 mr-2" />
              Sync Calls from PBX
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Extension</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getDirectionIcon(log.direction)}
                          <span className="text-xs font-medium uppercase">
                            {log.direction}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {log.caller_number}
                        {log.caller_name && <div className="text-xs text-gray-500">{log.caller_name}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {log.callee_number}
                        {log.callee_name && <div className="text-xs text-gray-500">{log.callee_name}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusBadge(log.status)}>
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatTime(log.start_time)}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {formatDuration(log.total_duration)}
                      </TableCell>
                      <TableCell className="text-sm">{log.extension || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-gray-600">
                Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total} calls
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0 || loading}
                  variant="outline"
                  size="sm"
                >
                  Previous
                </Button>
                <div className="flex items-center gap-2">
                  {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                    const pageNum = i;
                    return (
                      <Button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        variant={page === pageNum ? 'default' : 'outline'}
                        size="sm"
                      >
                        {pageNum + 1}
                      </Button>
                    );
                  })}
                  {totalPages > 5 && <span className="text-sm">...</span>}
                </div>
                <Button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1 || loading}
                  variant="outline"
                  size="sm"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
