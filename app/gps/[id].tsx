import React from 'react';
import { View, StyleSheet, Platform, TouchableOpacity, Text } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import GPSMatchViewer from '../../components/v2/GPSMatchViewer';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../../constants/theme';

export default function GPSFullScreenPage() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      
      <GPSMatchViewer matchId={params.id} />
      
      {Platform.OS === 'web' && (
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
          <Text style={styles.backText}>Volver al Partido</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    position: 'relative'
  },
  backBtn: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 100, 
  },
  backText: {
    fontFamily: FONTS.BOLD,
    color: '#0F172A',
    fontSize: 14,
  }
});
