export interface GroupMember {
  id: string;
  username?: string;
  role?: string;
  joinedAt?: string;
  // Add other member properties as needed
}

export interface Group {
  id: string;
  name: string;
  description: string;
  members: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount?: number;
  mintCost?: number;
  isPrivate?: boolean;
  code?: string;
  // Add other group properties as needed
} 