/**
 * Performance Monitor Component
 * 
 * PRIORITY 6: Real-time monitoring of optimization improvements
 * - Tracks Firestore reads per session
 * - Monitors cache efficiency
 * - Shows listener count and optimization metrics
 * - Provides visual feedback on performance gains
 */

import { useTheme } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import useAuctionStore from '../services/UltraEfficientAuctionService';

const PerformanceMonitor = ({ visible = true, compact = false }) => {
  const theme = useTheme();
  const [sessionStart] = useState(Date.now());
  const [updateCount, setUpdateCount] = useState(0);
  
  // Get raw metrics data from Zustand store to avoid infinite re-renders
  const sessionMetrics = useAuctionStore(state => state.sessionMetrics);
  const groupListeners = useAuctionStore(state => state.groupListeners);
  const cachedUsers = useAuctionStore(state => state.cachedUsers);
  
  // Calculate derived metrics in useMemo to prevent infinite re-renders
  const metrics = useMemo(() => {
    const cacheTotal = sessionMetrics.cacheHits + sessionMetrics.cacheMisses;
    return {
      reads: sessionMetrics.reads,
      cacheHits: sessionMetrics.cacheHits,
      cacheMisses: sessionMetrics.cacheMisses,
      listenersActive: Object.keys(groupListeners).length,
      cacheEfficiency: cacheTotal > 0 ? (sessionMetrics.cacheHits / cacheTotal * 100) : 0,
      groupsActive: Object.keys(groupListeners).length,
      totalCachedUsers: Object.keys(cachedUsers).length
    };
  }, [sessionMetrics, groupListeners, cachedUsers]);
  
  // Force re-render every 5 seconds to show live metrics
  useEffect(() => {
    if (!visible) return;
    
    const interval = setInterval(() => {
      setUpdateCount(prev => prev + 1);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [visible]);
  
  if (!visible || !__DEV__) return null;
  
  const sessionDuration = Math.floor((Date.now() - sessionStart) / 1000);
  const readsPerMinute = sessionDuration > 0 ? (metrics.reads / (sessionDuration / 60)).toFixed(1) : '0.0';
  
  const getEfficiencyColor = (efficiency) => {
    if (efficiency >= 80) return '#4CAF50'; // Green
    if (efficiency >= 60) return '#FF9800'; // Orange
    return '#F44336'; // Red
  };
  
  const getReadsColor = (reads) => {
    if (reads <= 10) return '#4CAF50'; // Green - excellent
    if (reads <= 25) return '#8BC34A'; // Light green - good
    if (reads <= 50) return '#FF9800'; // Orange - moderate
    return '#F44336'; // Red - needs improvement
  };
  
  if (compact) {
    return (
      <View style={[styles.compactContainer, { backgroundColor: theme.colors.surface }]}>
        <Text style={[styles.compactText, { color: getReadsColor(metrics.reads) }]}>
          📊 {metrics.reads} reads | {metrics.cacheEfficiency.toFixed(0)}% cache | {metrics.listenersActive} listeners
        </Text>
      </View>
    );
  }
  
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <Text style={[styles.title, { color: theme.colors.primary }]}>
        🚀 ULTRA-EFFICIENT Performance Monitor
      </Text>
      
      <View style={styles.metricsGrid}>
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.colors.text }]}>Session Reads</Text>
          <Text style={[styles.metricValue, { color: getReadsColor(metrics.reads) }]}>
            {metrics.reads}
          </Text>
          <Text style={[styles.metricSubtext, { color: theme.colors.text }]}>
            {readsPerMinute}/min
          </Text>
        </View>
        
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.colors.text }]}>Cache Efficiency</Text>
          <Text style={[styles.metricValue, { color: getEfficiencyColor(metrics.cacheEfficiency) }]}>
            {metrics.cacheEfficiency.toFixed(1)}%
          </Text>
          <Text style={[styles.metricSubtext, { color: theme.colors.text }]}>
            {metrics.cacheHits}/{metrics.cacheHits + metrics.cacheMisses}
          </Text>
        </View>
        
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.colors.text }]}>Active Listeners</Text>
          <Text style={[styles.metricValue, { color: metrics.listenersActive <= 1 ? '#4CAF50' : '#FF9800' }]}>
            {metrics.listenersActive}
          </Text>
          <Text style={[styles.metricSubtext, { color: theme.colors.text }]}>
            groups
          </Text>
        </View>
        
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: theme.colors.text }]}>Cached Users</Text>
          <Text style={[styles.metricValue, { color: theme.colors.primary }]}>
            {metrics.totalCachedUsers}
          </Text>
          <Text style={[styles.metricSubtext, { color: theme.colors.text }]}>
            users
          </Text>
        </View>
      </View>
      
      <View style={styles.statusRow}>
        <Text style={[styles.statusText, { color: theme.colors.text }]}>
          ⏱️ Session: {Math.floor(sessionDuration / 60)}m {sessionDuration % 60}s
        </Text>
        <Text style={[styles.statusText, { color: theme.colors.text }]}>
          🎯 Target: &lt;50 reads/session
        </Text>
      </View>
      
      {/* Performance Status Indicator */}
      <View style={styles.statusIndicator}>
        {metrics.reads <= 10 && (
          <Text style={[styles.statusBadge, { backgroundColor: '#4CAF50', color: 'white' }]}>
            🏆 EXCELLENT
          </Text>
        )}
        {metrics.reads > 10 && metrics.reads <= 25 && (
          <Text style={[styles.statusBadge, { backgroundColor: '#8BC34A', color: 'white' }]}>
            ✅ GOOD
          </Text>
        )}
        {metrics.reads > 25 && metrics.reads <= 50 && (
          <Text style={[styles.statusBadge, { backgroundColor: '#FF9800', color: 'white' }]}>
            ⚠️ MODERATE
          </Text>
        )}
        {metrics.reads > 50 && (
          <Text style={[styles.statusBadge, { backgroundColor: '#F44336', color: 'white' }]}>
            🚨 NEEDS OPTIMIZATION
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  compactContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginHorizontal: 8,
    marginVertical: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  compactText: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 2,
    textAlign: 'center',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 1,
  },
  metricSubtext: {
    fontSize: 9,
    opacity: 0.7,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statusText: {
    fontSize: 10,
    opacity: 0.8,
  },
  statusIndicator: {
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

export default PerformanceMonitor; 