/**
 * Read Dashboard - Development-Only Firestore Read Monitor
 * 
 * Real-time visual dashboard showing:
 * - Total reads this session
 * - Budget status (green/yellow/red)
 * - Breakdown by source/screen
 * - Recent read log
 * - Cache hit rate
 * 
 * Only renders in __DEV__ mode
 */

import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReadCircuitBreaker from '../../services/ReadTracking/ReadCircuitBreaker';
import ReadMonitor from '../../services/ReadTracking/ReadMonitor';

const ReadDashboard = () => {
  const [stats, setStats] = useState(ReadMonitor.getReport());
  const [expanded, setExpanded] = useState(false);
  const [circuitStatus, setCircuitStatus] = useState(ReadCircuitBreaker.getStatus());
  
  // Update stats every second
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(ReadMonitor.getReport());
      setCircuitStatus(ReadCircuitBreaker.getStatus());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  const { total, budget, remaining, percentage, status, bySource, byScreen, recentReads } = stats;
  
  // Determine color based on percentage
  const getStatusColor = () => {
    if (percentage >= 100) return '#ef4444'; // Red
    if (percentage >= 80) return '#f59e0b'; // Yellow
    return '#10b981'; // Green
  };
  
  const statusColor = getStatusColor();
  
  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);
  
  const resetMonitor = useCallback(async () => {
    await ReadMonitor.reset();
    setStats(ReadMonitor.getReport());
  }, []);
  
  // Compact floating button
  if (!expanded) {
    return (
      <TouchableOpacity 
        style={[styles.floatingButton, { backgroundColor: statusColor }]}
        onPress={toggleExpanded}
        activeOpacity={0.8}
      >
        <Text style={styles.floatingText}>
          📊 {total}/{budget}
        </Text>
        {percentage >= 100 && (
          <Text style={styles.floatingAlert}>⚠️</Text>
        )}
      </TouchableOpacity>
    );
  }
  
  // Expanded modal
  return (
    <Modal
      visible={expanded}
      transparent
      animationType="slide"
      onRequestClose={toggleExpanded}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>📊 Firestore Read Monitor</Text>
            <TouchableOpacity onPress={toggleExpanded} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          
          {/* Main Counter */}
          <View style={[styles.counterContainer, { borderColor: statusColor }]}>
            <Text style={styles.counterLabel}>Session Reads</Text>
            <Text style={[styles.counter, { color: statusColor }]}>
              {total} / {budget}
            </Text>
            <Text style={styles.counterSubtext}>{status}</Text>
          </View>
          
          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${Math.min(percentage, 100)}%`, backgroundColor: statusColor }
                ]} 
              />
            </View>
            <Text style={styles.progressText}>
              {remaining > 0 ? `${remaining} reads remaining` : `${Math.abs(remaining)} over budget!`}
            </Text>
          </View>
          
          {/* Circuit Breaker Status */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Circuit Breaker</Text>
            <View style={[styles.circuitStatus, { 
              backgroundColor: circuitStatus.isClosed ? '#10b981' : '#ef4444' 
            }]}>
              <Text style={styles.circuitText}>
                {circuitStatus.state} {circuitStatus.isOpen ? '🔴' : '🟢'}
              </Text>
              {circuitStatus.stats.blockedRequests > 0 && (
                <Text style={styles.circuitSubtext}>
                  Blocked: {circuitStatus.stats.blockedRequests} | 
                  Cache Hits: {circuitStatus.stats.cacheHits}
                </Text>
              )}
            </View>
          </View>
          
          {/* Breakdown by Source */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reads by Source</Text>
            <View style={styles.breakdown}>
              {Object.entries(bySource).length > 0 ? (
                Object.entries(bySource)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([source, count]) => (
                    <View key={source} style={styles.breakdownItem}>
                      <Text style={styles.breakdownSource}>{source}</Text>
                      <Text style={styles.breakdownCount}>{count}</Text>
                    </View>
                  ))
              ) : (
                <Text style={styles.emptyText}>No reads yet</Text>
              )}
            </View>
          </View>
          
          {/* Breakdown by Screen */}
          {Object.keys(byScreen).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reads by Screen</Text>
              <View style={styles.breakdown}>
                {Object.entries(byScreen)
                  .sort((a, b) => b[1] - a[1])
                  .map(([screen, count]) => (
                    <View key={screen} style={styles.breakdownItem}>
                      <Text style={styles.breakdownSource}>{screen}</Text>
                      <Text style={styles.breakdownCount}>{count}</Text>
                    </View>
                  ))}
              </View>
            </View>
          )}
          
          {/* Recent Reads Log */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Reads</Text>
            <FlatList
              data={recentReads}
              style={styles.logList}
              keyExtractor={(item, index) => `${item.timestamp}-${index}`}
              renderItem={({ item }) => (
                <View style={styles.logItem}>
                  <Text style={styles.logTime}>
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text style={styles.logText}>
                    {item.source} • {item.operation}
                  </Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No reads yet</Text>
              }
            />
          </View>
          
          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity 
              style={styles.resetButton}
              onPress={resetMonitor}
            >
              <Text style={styles.resetText}>🔄 Reset Counter</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.exportButton}
              onPress={() => {
                const report = ReadMonitor.exportSession();
                console.log('📊 Session Report:', JSON.stringify(report, null, 2));
                alert('Session data exported to console');
              }}
            >
              <Text style={styles.exportText}>📤 Export</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  // Floating button
  floatingButton: {
    position: 'absolute',
    top: 50,
    right: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 9999,
  },
  floatingText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  floatingAlert: {
    marginLeft: 4,
    fontSize: 16,
  },
  
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    fontSize: 24,
    color: '#6b7280',
  },
  
  // Counter
  counterContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 12,
    borderWidth: 3,
    marginBottom: 16,
  },
  counterLabel: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  counter: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  counterSubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
  
  // Progress
  progressContainer: {
    marginBottom: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  
  // Circuit Breaker
  circuitStatus: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  circuitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  circuitSubtext: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
  
  // Sections
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  
  // Breakdown
  breakdown: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
  },
  breakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  breakdownSource: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  breakdownCount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  
  // Log
  logList: {
    maxHeight: 150,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 8,
  },
  logItem: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  logTime: {
    fontSize: 12,
    color: '#6b7280',
    width: 80,
  },
  logText: {
    fontSize: 12,
    color: '#374151',
    flex: 1,
  },
  
  // Empty state
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    padding: 12,
  },
  
  // Actions
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  resetButton: {
    flex: 1,
    backgroundColor: '#3b82f6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  resetText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  exportButton: {
    flex: 1,
    backgroundColor: '#10b981',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  exportText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default ReadDashboard;

