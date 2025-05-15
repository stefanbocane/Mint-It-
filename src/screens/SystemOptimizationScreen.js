import NetInfo from '@react-native-community/netinfo';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Card, Chip, Divider, IconButton, List, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import * as aggregationService from '../utils/aggregationService';
import * as appBootstrapCoordinator from '../utils/appBootstrapCoordinator';
import * as backgroundJobScheduler from '../utils/backgroundJobScheduler';
import * as dataCleanupService from '../utils/dataCleanupService';
import * as smartListenerManager from '../utils/smartListenerManager';
// Import centralized services
import CacheService from '../services/caching/CacheService';
import { handleError } from '../services/ErrorHandlingService';
import BatchService from '../services/BatchService';
import timeUtils from '../utils/timeUtils';

const SystemOptimizationScreen = () => {
  const theme = useTheme();
  const { user } = useAuth();
  const isFocused = useIsFocused();
  
  // State
  const [isLoading, setIsLoading] = useState(false);
  const [systemStats, setSystemStats] = useState({
    cacheSize: 0,
    listeners: { activeCount: 0, totalCount: 0 },
    queryStats: [],
    backgroundJobs: { pending: 0, running: 0, completed: 0, failed: 0 },
    paginationCaches: { totalCaches: 0 },
    bootState: null,
    network: { isConnected: true }
  });
  const [expandedSections, setExpandedSections] = useState({
    cache: false,
    listeners: false,
    jobs: false,
    queries: false,
    pagination: false
  });
  
  // Job execution state
  const [jobRunning, setJobRunning] = useState(false);
  const [jobResults, setJobResults] = useState(null);
  
  // Load data on focus
  useEffect(() => {
    if (isFocused) {
      loadSystemStats();
    }
  }, [isFocused]);
  
  // Load system stats
  const loadSystemStats = async () => {
    setIsLoading(true);
    
    try {
      // Get network state
      const networkState = await NetInfo.fetch();
      
      // Get cache size with error handling
      let cacheSize = 0;
      try {
        // Use CacheService for cache metrics
        const cacheMetrics = await CacheService.getMetrics();
        cacheSize = cacheMetrics.totalSize || 0;
      } catch (error) {
        handleError(error, {
          context: 'System Optimization',
          operation: 'Getting cache size'
        });
        // Continue with default value of 0
      }
      
      // Get listener stats
      const listeners = smartListenerManager.getListenerStats();
      
      // Get query access stats from CacheService instead of enhancedQueryCache
      const queryStats = await CacheService.getQueryAccessReport();
      
      // Get background job status
      let jobStatus = { jobCounts: { pending: 0, running: 0, completed: 0, failed: 0 } };
      try {
        jobStatus = await backgroundJobScheduler.getJobStatus();
      } catch (error) {
        handleError(error, {
          context: 'System Optimization',
          operation: 'Getting job status'
        });
        // Continue with default job status
      }
      
      // Get pagination cache stats from CacheService
      const paginationCaches = await CacheService.getPaginationCacheStats();
      
      // Get bootstrap state
      const bootState = appBootstrapCoordinator.getBootstrapState();
      
      setSystemStats({
        cacheSize,
        listeners,
        queryStats,
        backgroundJobs: {
          pending: jobStatus.jobCounts?.pending || 0,
          running: jobStatus.jobCounts?.running || 0,
          completed: jobStatus.jobCounts?.completed || 0,
          failed: jobStatus.jobCounts?.failed || 0,
          lastMaintenanceRun: jobStatus.lastMaintenanceRun,
          lastAggregationRun: jobStatus.lastAggregationRun,
          maintenanceDue: jobStatus.maintenanceDue,
          aggregationDue: jobStatus.aggregationDue
        },
        paginationCaches,
        bootState,
        network: {
          isConnected: networkState.isConnected && networkState.isInternetReachable,
          type: networkState.type,
          details: networkState.details
        }
      });
    } catch (error) {
      handleError(error, {
        context: 'System Optimization',
        operation: 'Loading system stats',
        showToUser: true
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Toggle section expansion
  const toggleSection = (section) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section]
    });
  };
  
  // Run database maintenance
  const runDatabaseMaintenance = async () => {
    if (jobRunning) return;
    
    setJobRunning(true);
    setJobResults(null);
    
    try {
      const results = await dataCleanupService.performDatabaseMaintenance();
      setJobResults({
        type: 'maintenance',
        success: true,
        data: results
      });
      
      // Refresh stats after completion
      loadSystemStats();
    } catch (error) {
      handleError(error, {
        context: 'System Optimization',
        operation: 'Database maintenance',
        showToUser: true
      });
      
      setJobResults({
        type: 'maintenance',
        success: false,
        error: error.message
      });
    } finally {
      setJobRunning(false);
    }
  };
  
  // Run data aggregation
  const runDataAggregation = async () => {
    if (jobRunning) return;
    
    setJobRunning(true);
    setJobResults(null);
    
    try {
      const results = await aggregationService.runAllAggregations();
      setJobResults({
        type: 'aggregation',
        success: true,
        data: results
      });
      
      // Refresh stats after completion
      loadSystemStats();
    } catch (error) {
      handleError(error, {
        context: 'System Optimization',
        operation: 'Data aggregation',
        showToUser: true
      });
      
      setJobResults({
        type: 'aggregation',
        success: false,
        error: error.message
      });
    } finally {
      setJobRunning(false);
    }
  };
  
  // Clear cached data
  const clearAllCaches = async () => {
    if (jobRunning) return;
    
    setJobRunning(true);
    setJobResults(null);
    
    try {
      // Use centralized CacheService to clear all caches
      await CacheService.clearAll();
      smartListenerManager.cleanupAllListeners();
      
      setJobResults({
        type: 'cache-clear',
        success: true,
        message: 'All caches cleared successfully'
      });
      
      // Refresh stats after completion
      loadSystemStats();
    } catch (error) {
      handleError(error, {
        context: 'System Optimization',
        operation: 'Clearing caches',
        showToUser: true
      });
      
      setJobResults({
        type: 'cache-clear',
        success: false,
        error: error.message
      });
    } finally {
      setJobRunning(false);
    }
  };
  
  // Process background jobs
  const processBackgroundJobs = async () => {
    if (jobRunning) return;
    
    setJobRunning(true);
    setJobResults(null);
    
    try {
      const processedCount = await backgroundJobScheduler.processJobs(5);
      setJobResults({
        type: 'process-jobs',
        success: true,
        message: `Processed ${processedCount} background jobs`
      });
      
      // Refresh stats after completion
      loadSystemStats();
    } catch (error) {
      setJobResults({
        type: 'process-jobs',
        success: false,
        error: error.message
      });
    } finally {
      setJobRunning(false);
    }
  };
  
  // Prefetch frequent queries
  const prefetchFrequentQueries = async () => {
    if (jobRunning) return;
    
    setJobRunning(true);
    setJobResults(null);
    
    try {
      const prefetchCount = await enhancedQueryCache.prefetchFrequentQueries();
      setJobResults({
        type: 'prefetch-queries',
        success: true,
        message: `Prefetched ${prefetchCount} frequent queries`
      });
      
      // Refresh stats after completion
      loadSystemStats();
    } catch (error) {
      setJobResults({
        type: 'prefetch-queries',
        success: false,
        error: error.message
      });
    } finally {
      setJobRunning(false);
    }
  };
  
  // Retry bootstrap
  const retryBootstrap = async () => {
    if (jobRunning) return;
    
    setJobRunning(true);
    setJobResults(null);
    
    try {
      const result = await appBootstrapCoordinator.retryBootstrap(user);
      setJobResults({
        type: 'bootstrap',
        success: result.success,
        message: result.success ? 
          `Bootstrap completed in ${result.duration}ms` : 
          `Bootstrap failed: ${result.error}`
      });
      
      // Refresh stats after completion
      loadSystemStats();
    } catch (error) {
      setJobResults({
        type: 'bootstrap',
        success: false,
        error: error.message
      });
    } finally {
      setJobRunning(false);
    }
  };
  
  // Format bytes to human-readable form
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };
  
  // Use the standardized date formatter from timeUtils
  const { formatDate } = require('../utils/timeUtils');
  
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={loadSystemStats} />
        }
      >
        <Card style={styles.card}>
          <Card.Title title="System Optimization Dashboard" />
          <Card.Content>
            <Text style={styles.subtitle}>
              Monitor and manage system optimizations
            </Text>
            
            <View style={styles.statsRow}>
              <Chip icon="database" mode="outlined" style={styles.chip}>
                {formatBytes(systemStats.cacheSize)}
              </Chip>
              <Chip 
                icon="access-point" 
                mode="outlined" 
                style={[
                  styles.chip, 
                  !systemStats.network.isConnected && styles.chipWarning
                ]}
              >
                {systemStats.network.isConnected ? 'Online' : 'Offline'}
              </Chip>
              <Chip 
                icon="ear-hearing" 
                mode="outlined" 
                style={styles.chip}
              >
                {systemStats.listeners.activeCount} Listeners
              </Chip>
              <Chip 
                icon="briefcase-clock" 
                mode="outlined" 
                style={styles.chip}
              >
                {systemStats.backgroundJobs.pending} Jobs
              </Chip>
            </View>
          </Card.Content>
        </Card>
        
        {jobResults && (
          <Card style={[styles.card, styles.resultCard]}>
            <Card.Title 
              title="Operation Results" 
              right={(props) => (
                <IconButton
                  {...props}
                  icon="close"
                  onPress={() => setJobResults(null)}
                />
              )}
            />
            <Card.Content>
              <Text style={[
                styles.resultText,
                jobResults.success ? styles.successText : styles.errorText
              ]}>
                {jobResults.success ? '✅ Success' : '❌ Error'}
              </Text>
              {jobResults.message && (
                <Text style={styles.resultMessage}>{jobResults.message}</Text>
              )}
              {jobResults.error && (
                <Text style={styles.errorText}>{jobResults.error}</Text>
              )}
              {jobResults.data && (
                <View style={styles.resultDataContainer}>
                  {Object.entries(jobResults.data).map(([key, value]) => {
                    if (typeof value === 'object') return null;
                    return (
                      <Text key={key} style={styles.resultDataItem}>
                        {key}: {value}
                      </Text>
                    );
                  })}
                </View>
              )}
            </Card.Content>
          </Card>
        )}
        
        <Card style={styles.card}>
          <Card.Title title="Maintenance Tools" />
          <Card.Content>
            <View style={styles.buttonsContainer}>
              <Button 
                mode="contained" 
                onPress={runDatabaseMaintenance}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="database-refresh"
              >
                Database Cleanup
              </Button>
              
              <Button 
                mode="contained" 
                onPress={runDataAggregation}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="chart-timeline-variant"
              >
                Run Aggregations
              </Button>
              
              <Button 
                mode="contained" 
                onPress={clearAllCaches}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="cached"
              >
                Clear All Caches
              </Button>
              
              <Button 
                mode="contained" 
                onPress={processBackgroundJobs}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="briefcase-clock"
              >
                Process Jobs
              </Button>
              
              <Button 
                mode="contained" 
                onPress={prefetchFrequentQueries}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="rocket-launch"
              >
                Prefetch Data
              </Button>
              
              <Button 
                mode="contained" 
                onPress={retryBootstrap}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="restart"
              >
                Retry Bootstrap
              </Button>
            </View>
          </Card.Content>
        </Card>
        
        {/* Background Jobs Section */}
        <Card style={styles.card}>
          <TouchableOpacity onPress={() => toggleSection('jobs')}>
            <Card.Title 
              title="Background Jobs" 
              right={(props) => (
                <IconButton
                  {...props}
                  icon={expandedSections.jobs ? "chevron-up" : "chevron-down"}
                  onPress={() => toggleSection('jobs')}
                />
              )}
            />
          </TouchableOpacity>
          
          {expandedSections.jobs && (
            <Card.Content>
              <View style={styles.statsGrid}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.backgroundJobs.pending}</Text>
                  <Text style={styles.statLabel}>Pending</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.backgroundJobs.running}</Text>
                  <Text style={styles.statLabel}>Running</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.backgroundJobs.completed}</Text>
                  <Text style={styles.statLabel}>Completed</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.backgroundJobs.failed}</Text>
                  <Text style={styles.statLabel}>Failed</Text>
                </View>
              </View>
              
              <Divider style={styles.divider} />
              
              <List.Item
                title="Last Maintenance Run"
                description={formatDate(systemStats.backgroundJobs.lastMaintenanceRun)}
                left={props => <List.Icon {...props} icon="database-sync" />}
              />
              
              <List.Item
                title="Last Aggregation Run"
                description={formatDate(systemStats.backgroundJobs.lastAggregationRun)}
                left={props => <List.Icon {...props} icon="chart-bell-curve" />}
              />
              
              <List.Item
                title="Maintenance Status"
                description={systemStats.backgroundJobs.maintenanceDue ? "Due" : "Up to date"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.backgroundJobs.maintenanceDue ? "alert-circle" : "check-circle"} 
                    color={systemStats.backgroundJobs.maintenanceDue ? theme.colors.error : theme.colors.primary}
                  />
                )}
              />
              
              <List.Item
                title="Aggregation Status"
                description={systemStats.backgroundJobs.aggregationDue ? "Due" : "Up to date"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.backgroundJobs.aggregationDue ? "alert-circle" : "check-circle"} 
                    color={systemStats.backgroundJobs.aggregationDue ? theme.colors.error : theme.colors.primary}
                  />
                )}
              />
            </Card.Content>
          )}
        </Card>
        
        {/* Smart Listeners Section */}
        <Card style={styles.card}>
          <TouchableOpacity onPress={() => toggleSection('listeners')}>
            <Card.Title 
              title="Smart Listeners" 
              right={(props) => (
                <IconButton
                  {...props}
                  icon={expandedSections.listeners ? "chevron-up" : "chevron-down"}
                  onPress={() => toggleSection('listeners')}
                />
              )}
            />
          </TouchableOpacity>
          
          {expandedSections.listeners && (
            <Card.Content>
              <View style={styles.statsGrid}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.listeners.activeCount}</Text>
                  <Text style={styles.statLabel}>Active</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.listeners.inactiveCount || 0}</Text>
                  <Text style={styles.statLabel}>Inactive</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{systemStats.listeners.totalCount}</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
              </View>
              
              <Divider style={styles.divider} />
              
              {systemStats.listeners.activeListeners && 
                systemStats.listeners.activeListeners.length > 0 ? (
                <List.Section>
                  <List.Subheader>Active Listeners</List.Subheader>
                  {systemStats.listeners.activeListeners.map((listener, index) => (
                    <List.Item
                      key={index}
                      title={listener.key}
                      description={`Last updated: ${formatDate(listener.lastUpdateTime)}`}
                      left={props => <List.Icon {...props} icon="ear-hearing" />}
                    />
                  ))}
                </List.Section>
              ) : (
                <Text style={styles.emptyText}>No active listeners</Text>
              )}
            </Card.Content>
          )}
        </Card>
        
        {/* Frequent Queries Section */}
        <Card style={styles.card}>
          <TouchableOpacity onPress={() => toggleSection('queries')}>
            <Card.Title 
              title="Frequent Queries" 
              right={(props) => (
                <IconButton
                  {...props}
                  icon={expandedSections.queries ? "chevron-up" : "chevron-down"}
                  onPress={() => toggleSection('queries')}
                />
              )}
            />
          </TouchableOpacity>
          
          {expandedSections.queries && (
            <Card.Content>
              {systemStats.queryStats && systemStats.queryStats.length > 0 ? (
                <List.Section>
                  {systemStats.queryStats.slice(0, 5).map((query, index) => (
                    <List.Item
                      key={index}
                      title={query.key.length > 40 ? `${query.key.substring(0, 40)}...` : query.key}
                      description={`${query.accessCount} accesses, last: ${formatDate(query.lastAccess)}`}
                      left={props => (
                        <List.Icon 
                          {...props} 
                          icon={query.isFrequent ? "star" : "star-outline"} 
                          color={query.isFrequent ? theme.colors.primary : undefined}
                        />
                      )}
                    />
                  ))}
                </List.Section>
              ) : (
                <Text style={styles.emptyText}>No query statistics available</Text>
              )}
              
              <Button 
                mode="outlined" 
                onPress={prefetchFrequentQueries}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
              >
                Prefetch Frequent Queries
              </Button>
            </Card.Content>
          )}
        </Card>
        
        {/* Pagination Caches Section */}
        <Card style={styles.card}>
          <TouchableOpacity onPress={() => toggleSection('pagination')}>
            <Card.Title 
              title="Pagination Caches" 
              right={(props) => (
                <IconButton
                  {...props}
                  icon={expandedSections.pagination ? "chevron-up" : "chevron-down"}
                  onPress={() => toggleSection('pagination')}
                />
              )}
            />
          </TouchableOpacity>
          
          {expandedSections.pagination && (
            <Card.Content>
              <Text style={styles.statLabel}>
                Total Caches: {systemStats.paginationCaches.totalCaches}
              </Text>
              
              {systemStats.paginationCaches.caches && 
                systemStats.paginationCaches.caches.length > 0 ? (
                <List.Section>
                  {systemStats.paginationCaches.caches.map((cache, index) => (
                    <List.Item
                      key={index}
                      title={cache.key.length > 40 ? `${cache.key.substring(0, 40)}...` : cache.key}
                      description={`${cache.totalItems} items, ${cache.cachedPages.length} pages`}
                      left={props => <List.Icon {...props} icon="file-document-multiple" />}
                    />
                  ))}
                </List.Section>
              ) : (
                <Text style={styles.emptyText}>No pagination caches available</Text>
              )}
              
              <Button 
                mode="outlined" 
                onPress={() => {
                  paginationCacheService.clearAllPaginationCaches();
                  loadSystemStats();
                }}
                style={styles.button}
              >
                Clear Pagination Caches
              </Button>
            </Card.Content>
          )}
        </Card>
        
        {/* Bootstrap State Section */}
        <Card style={styles.card}>
          <TouchableOpacity onPress={() => toggleSection('boot')}>
            <Card.Title 
              title="App Bootstrap State" 
              right={(props) => (
                <IconButton
                  {...props}
                  icon={expandedSections.boot ? "chevron-up" : "chevron-down"}
                  onPress={() => toggleSection('boot')}
                />
              )}
            />
          </TouchableOpacity>
          
          {expandedSections.boot && systemStats.bootState && (
            <Card.Content>
              <List.Item
                title="Initialization Status"
                description={systemStats.bootState.isInitialized ? "Initialized" : "Not Initialized"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.bootState.isInitialized ? "check-circle" : "alert-circle"} 
                    color={systemStats.bootState.isInitialized ? theme.colors.primary : theme.colors.error}
                  />
                )}
              />
              
              <List.Item
                title="Critical Data"
                description={systemStats.bootState.criticalDataLoaded ? "Loaded" : "Not Loaded"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.bootState.criticalDataLoaded ? "check-circle" : "alert-circle"} 
                    color={systemStats.bootState.criticalDataLoaded ? theme.colors.primary : theme.colors.error}
                  />
                )}
              />
              
              <List.Item
                title="Essential Data"
                description={systemStats.bootState.essentialDataLoaded ? "Loaded" : "Not Loaded"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.bootState.essentialDataLoaded ? "check-circle" : "alert-circle"} 
                    color={systemStats.bootState.essentialDataLoaded ? theme.colors.primary : theme.colors.error}
                  />
                )}
              />
              
              <List.Item
                title="Non-Essential Data"
                description={systemStats.bootState.nonEssentialDataLoaded ? "Loaded" : "Not Loaded"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.bootState.nonEssentialDataLoaded ? "check-circle" : "progress-check"} 
                    color={systemStats.bootState.nonEssentialDataLoaded ? theme.colors.primary : theme.colors.secondary}
                  />
                )}
              />
              
              <List.Item
                title="Offline Mode"
                description={systemStats.bootState.offlineMode ? "Enabled" : "Disabled"}
                left={props => (
                  <List.Icon 
                    {...props} 
                    icon={systemStats.bootState.offlineMode ? "wifi-off" : "wifi"} 
                    color={systemStats.bootState.offlineMode ? theme.colors.error : theme.colors.primary}
                  />
                )}
              />
              
              <List.Item
                title="Last Bootstrap"
                description={systemStats.bootState.lastBootstrapTime ? 
                  formatDate(systemStats.bootState.lastBootstrapTime) : "Never"}
                left={props => <List.Icon {...props} icon="timer" />}
              />
              
              {systemStats.bootState.errors && systemStats.bootState.errors.length > 0 && (
                <List.Accordion title="Bootstrap Errors" left={props => <List.Icon {...props} icon="alert" />}>
                  {systemStats.bootState.errors.map((error, index) => (
                    <List.Item
                      key={index}
                      title={`Error in ${error.phase} phase`}
                      description={`${error.error} (${formatDate(error.time)})`}
                    />
                  ))}
                </List.Accordion>
              )}
              
              <Button 
                mode="outlined" 
                onPress={retryBootstrap}
                loading={jobRunning && !jobResults}
                disabled={jobRunning}
                style={styles.button}
                icon="restart"
              >
                Retry Bootstrap
              </Button>
            </Card.Content>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  card: {
    margin: 8,
    elevation: 2,
  },
  resultCard: {
    backgroundColor: '#f8f9fa',
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
    opacity: 0.7,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 8,
  },
  chip: {
    margin: 4,
  },
  chipWarning: {
    backgroundColor: 'rgba(255, 87, 34, 0.1)',
  },
  buttonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  button: {
    margin: 4,
    minWidth: '45%',
  },
  divider: {
    marginVertical: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginVertical: 8,
  },
  statItem: {
    alignItems: 'center',
    minWidth: 70,
    margin: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.7,
  },
  emptyText: {
    textAlign: 'center',
    margin: 16,
    opacity: 0.5,
  },
  resultText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resultMessage: {
    marginBottom: 8,
  },
  successText: {
    color: 'green',
  },
  errorText: {
    color: 'red',
  },
  resultDataContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 4,
  },
  resultDataItem: {
    fontSize: 12,
    marginVertical: 2,
  },
});

export default SystemOptimizationScreen; 