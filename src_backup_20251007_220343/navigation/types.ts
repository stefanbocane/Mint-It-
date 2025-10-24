import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Card } from '../types/card';
import { Group } from '../types/group';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  Groups: undefined;
  GroupDetails: { group: Group };
  CreateGroup: undefined;
  JoinGroup: undefined;
  MyCollection: { group?: Group; onSelectCard?: (card: Card) => void };
  Settings: undefined;
  Profile: undefined;
  CreateTrade: { initialCardId?: string };
  TradesOverview: undefined;
  Mint: undefined;
  Social: {
    screen: 'CreateGroup' | 'JoinGroup';
  };
};

export type RootStackNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>; 