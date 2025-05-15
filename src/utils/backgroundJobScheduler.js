import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as aggregationService from './aggregationService';
import * as dataCleanupService from './dataCleanupService';

// Keys for tracking job execution
const JOB_KEYS = {
  LAST_MAINTENANCE_RUN: 'last_maintenance_run',
  LAST_AGGREGATION_RUN: 'last_aggregation_run',
  PENDING_JOBS: 'pending_background_jobs',
  MAINTENANCE_INTERVAL: 'maintenance_interval_hours',
  AGGREGATION_INTERVAL: 'aggregation_interval_hours'
};

// Default intervals
const DEFAULT_MAINTENANCE_INTERVAL = 24; // hours
const DEFAULT_AGGREGATION_INTERVAL = 12; // hours

// Jobs that can be scheduled
const JOB_TYPES = {
  MAINTENANCE: 'database_maintenance',
  AGGREGATION: 'data_aggregation',
  AUCTION_CLEANUP: 'auction_cleanup',
  USER_STATS: 'user_stats_update',
  GROUP_STATS: 'group_stats_update'
};

/**
 * Initialize the background job scheduler and set default intervals
 * 
 * @returns {Promise<void>}
 */
export const initJobScheduler = async () => {
  try {
    // Check if intervals are already set
    const maintenanceInterval = await AsyncStorage.getItem(JOB_KEYS.MAINTENANCE_INTERVAL);
    const aggregationInterval = await AsyncStorage.getItem(JOB_KEYS.AGGREGATION_INTERVAL);
    
    // Set default intervals if not already set
    if (!maintenanceInterval) {
      await AsyncStorage.setItem(
        JOB_KEYS.MAINTENANCE_INTERVAL, 
        DEFAULT_MAINTENANCE_INTERVAL.toString()
      );
    }
    
    if (!aggregationInterval) {
      await AsyncStorage.setItem(
        JOB_KEYS.AGGREGATION_INTERVAL, 
        DEFAULT_AGGREGATION_INTERVAL.toString()
      );
    }
    
    // Initialize pending jobs if needed
    const pendingJobs = await AsyncStorage.getItem(JOB_KEYS.PENDING_JOBS);
    if (!pendingJobs) {
      await AsyncStorage.setItem(JOB_KEYS.PENDING_JOBS, JSON.stringify([]));
    }
    
    console.log('Background job scheduler initialized');
  } catch (error) {
    console.error('Error initializing job scheduler:', error);
  }
};

/**
 * Schedule a job to be run in the background
 * 
 * @param {string} jobType - Type of job from JOB_TYPES
 * @param {object} jobData - Additional data for the job
 * @param {boolean} highPriority - Whether this job should run at next opportunity
 * @returns {Promise<string>} - Job ID
 */
export const scheduleJob = async (jobType, jobData = {}, highPriority = false) => {
  try {
    // Generate a job ID
    const jobId = `${jobType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create job object
    const job = {
      id: jobId,
      type: jobType,
      data: jobData,
      createdAt: new Date().toISOString(),
      priority: highPriority ? 'high' : 'normal',
      status: 'pending',
      attempts: 0
    };
    
    // Add to pending jobs
    const pendingJobsString = await AsyncStorage.getItem(JOB_KEYS.PENDING_JOBS);
    const pendingJobs = pendingJobsString ? JSON.parse(pendingJobsString) : [];
    
    // Add the new job
    pendingJobs.push(job);
    
    // Sort by priority and creation date
    pendingJobs.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority !== 'high' && b.priority === 'high') return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    
    // Save back to storage
    await AsyncStorage.setItem(JOB_KEYS.PENDING_JOBS, JSON.stringify(pendingJobs));
    
    console.log(`Scheduled job ${jobId} of type ${jobType}`);
    return jobId;
  } catch (error) {
    console.error('Error scheduling job:', error);
    return null;
  }
};

/**
 * Check if scheduled maintenance is due
 * 
 * @returns {Promise<boolean>} - Whether maintenance is due
 */
export const isMaintenanceDue = async () => {
  try {
    const lastRunString = await AsyncStorage.getItem(JOB_KEYS.LAST_MAINTENANCE_RUN);
    const intervalString = await AsyncStorage.getItem(JOB_KEYS.MAINTENANCE_INTERVAL);
    
    // If never run before, it's due
    if (!lastRunString) return true;
    
    const lastRun = new Date(lastRunString);
    const interval = parseInt(intervalString || DEFAULT_MAINTENANCE_INTERVAL.toString());
    
    // Check if the interval has passed
    const now = new Date();
    const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);
    
    return hoursSinceLastRun >= interval;
  } catch (error) {
    console.error('Error checking if maintenance is due:', error);
    return false;
  }
};

/**
 * Check if scheduled aggregation is due
 * 
 * @returns {Promise<boolean>} - Whether aggregation is due
 */
export const isAggregationDue = async () => {
  try {
    const lastRunString = await AsyncStorage.getItem(JOB_KEYS.LAST_AGGREGATION_RUN);
    const intervalString = await AsyncStorage.getItem(JOB_KEYS.AGGREGATION_INTERVAL);
    
    // If never run before, it's due
    if (!lastRunString) return true;
    
    const lastRun = new Date(lastRunString);
    const interval = parseInt(intervalString || DEFAULT_AGGREGATION_INTERVAL.toString());
    
    // Check if the interval has passed
    const now = new Date();
    const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);
    
    return hoursSinceLastRun >= interval;
  } catch (error) {
    console.error('Error checking if aggregation is due:', error);
    return false;
  }
};

/**
 * Process a single job from the queue
 * 
 * @param {object} job - Job to process
 * @returns {Promise<object>} - Result of the job
 */
export const processJob = async (job) => {
  try {
    console.log(`Processing job ${job.id} of type ${job.type}`);
    
    // Update job status
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.attempts += 1;
    
    // Run the appropriate job based on type
    let result = null;
    
    switch (job.type) {
      case JOB_TYPES.MAINTENANCE:
        result = await dataCleanupService.performDatabaseMaintenance();
        // Record the last run time for scheduled maintenance
        await AsyncStorage.setItem(JOB_KEYS.LAST_MAINTENANCE_RUN, new Date().toISOString());
        break;
        
      case JOB_TYPES.AGGREGATION:
        result = await aggregationService.runAllAggregations();
        // Record the last run time for scheduled aggregation
        await AsyncStorage.setItem(JOB_KEYS.LAST_AGGREGATION_RUN, new Date().toISOString());
        break;
        
      case JOB_TYPES.AUCTION_CLEANUP:
        result = await dataCleanupService.archiveOldAuctions(job.data.daysOld || 30);
        break;
        
      case JOB_TYPES.USER_STATS:
        result = await aggregationService.updateUserCollectionStats(job.data.userId);
        break;
        
      case JOB_TYPES.GROUP_STATS:
        result = await aggregationService.updateGroupStats(job.data.groupId);
        break;
        
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
    
    // Job completed successfully
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.result = result;
    
    console.log(`Job ${job.id} completed successfully`);
    return job;
  } catch (error) {
    // Job failed
    console.error(`Error processing job ${job.id}:`, error);
    
    job.status = 'failed';
    job.error = error.message;
    job.failedAt = new Date().toISOString();
    
    return job;
  }
};

/**
 * Process pending jobs if conditions are right
 * 
 * @param {number} maxJobs - Maximum number of jobs to process
 * @returns {Promise<number>} - Number of jobs processed
 */
export const processJobs = async (maxJobs = 3) => {
  try {
    // Check network status
    const networkState = await NetInfo.fetch();
    const isConnected = networkState.isConnected && networkState.isInternetReachable;
    
    if (!isConnected) {
      console.log('Not connected to the internet, skipping job processing');
      return 0;
    }
    
    // Get pending jobs
    const pendingJobsString = await AsyncStorage.getItem(JOB_KEYS.PENDING_JOBS);
    const pendingJobs = pendingJobsString ? JSON.parse(pendingJobsString) : [];
    
    if (pendingJobs.length === 0) {
      return 0;
    }
    
    // Process up to maxJobs
    let processed = 0;
    const updatedJobs = [...pendingJobs];
    
    for (let i = 0; i < Math.min(maxJobs, pendingJobs.length); i++) {
      const job = pendingJobs[i];
      
      // Skip jobs that are already running or completed
      if (job.status === 'running' || job.status === 'completed') {
        continue;
      }
      
      // Process the job
      const processedJob = await processJob(job);
      
      // Update the job in the list
      const jobIndex = updatedJobs.findIndex(j => j.id === job.id);
      if (jobIndex !== -1) {
        updatedJobs[jobIndex] = processedJob;
      }
      
      processed++;
    }
    
    // Remove completed jobs after 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const filteredJobs = updatedJobs.filter(job => {
      // Keep if not completed or failed, or if completed/failed recently
      return (
        job.status !== 'completed' && job.status !== 'failed'
      ) || (
        job.completedAt && job.completedAt > oneDayAgo
      ) || (
        job.failedAt && job.failedAt > oneDayAgo
      );
    });
    
    // Save updated jobs
    await AsyncStorage.setItem(JOB_KEYS.PENDING_JOBS, JSON.stringify(filteredJobs));
    
    console.log(`Processed ${processed} jobs, ${filteredJobs.length} jobs remaining`);
    return processed;
  } catch (error) {
    console.error('Error processing jobs:', error);
    return 0;
  }
};

/**
 * Check and schedule routine maintenance jobs if needed
 * 
 * @returns {Promise<void>}
 */
export const checkAndScheduleRoutineJobs = async () => {
  try {
    // Check if maintenance is due
    const maintenanceDue = await isMaintenanceDue();
    if (maintenanceDue) {
      console.log('Database maintenance is due, scheduling job');
      await scheduleJob(JOB_TYPES.MAINTENANCE, {}, false);
    }
    
    // Check if aggregation is due
    const aggregationDue = await isAggregationDue();
    if (aggregationDue) {
      console.log('Data aggregation is due, scheduling job');
      await scheduleJob(JOB_TYPES.AGGREGATION, {}, false);
    }
  } catch (error) {
    console.error('Error scheduling routine jobs:', error);
  }
};

/**
 * Get the status of all jobs
 * 
 * @returns {Promise<object>} - Job status information
 */
export const getJobStatus = async () => {
  try {
    // Get pending jobs
    const pendingJobsString = await AsyncStorage.getItem(JOB_KEYS.PENDING_JOBS);
    const pendingJobs = pendingJobsString ? JSON.parse(pendingJobsString) : [];
    
    // Get last run times
    const lastMaintenanceRun = await AsyncStorage.getItem(JOB_KEYS.LAST_MAINTENANCE_RUN);
    const lastAggregationRun = await AsyncStorage.getItem(JOB_KEYS.LAST_AGGREGATION_RUN);
    
    // Get intervals
    const maintenanceInterval = await AsyncStorage.getItem(JOB_KEYS.MAINTENANCE_INTERVAL);
    const aggregationInterval = await AsyncStorage.getItem(JOB_KEYS.AGGREGATION_INTERVAL);
    
    // Calculate counts
    const jobCounts = {
      pending: pendingJobs.filter(job => job.status === 'pending').length,
      running: pendingJobs.filter(job => job.status === 'running').length,
      completed: pendingJobs.filter(job => job.status === 'completed').length,
      failed: pendingJobs.filter(job => job.status === 'failed').length,
      total: pendingJobs.length
    };
    
    return {
      jobCounts,
      lastMaintenanceRun,
      lastAggregationRun,
      maintenanceInterval: parseInt(maintenanceInterval || DEFAULT_MAINTENANCE_INTERVAL.toString()),
      aggregationInterval: parseInt(aggregationInterval || DEFAULT_AGGREGATION_INTERVAL.toString()),
      maintenanceDue: await isMaintenanceDue(),
      aggregationDue: await isAggregationDue(),
      allJobs: pendingJobs
    };
  } catch (error) {
    console.error('Error getting job status:', error);
    return {
      error: error.message
    };
  }
};

/**
 * Set the interval for maintenance jobs
 * 
 * @param {number} hours - Hours between maintenance runs
 * @returns {Promise<void>}
 */
export const setMaintenanceInterval = async (hours) => {
  if (hours < 1) {
    throw new Error('Maintenance interval must be at least 1 hour');
  }
  
  await AsyncStorage.setItem(JOB_KEYS.MAINTENANCE_INTERVAL, hours.toString());
  console.log(`Maintenance interval set to ${hours} hours`);
};

/**
 * Set the interval for aggregation jobs
 * 
 * @param {number} hours - Hours between aggregation runs
 * @returns {Promise<void>}
 */
export const setAggregationInterval = async (hours) => {
  if (hours < 1) {
    throw new Error('Aggregation interval must be at least 1 hour');
  }
  
  await AsyncStorage.setItem(JOB_KEYS.AGGREGATION_INTERVAL, hours.toString());
  console.log(`Aggregation interval set to ${hours} hours`);
};

export default {
  JOB_TYPES,
  initJobScheduler,
  scheduleJob,
  processJobs,
  getJobStatus,
  checkAndScheduleRoutineJobs,
  setMaintenanceInterval,
  setAggregationInterval
}; 