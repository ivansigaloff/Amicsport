import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const COOKIE_ACCEPTED_KEY = 'amic_sport_cookies_accepted';

export default function CookieBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const slideAnim = useState(new Animated.Value(200))[0];

  useEffect(() => {
    checkAcceptance();
  }, []);

  const checkAcceptance = async () => {
    const accepted = await AsyncStorage.getItem(COOKIE_ACCEPTED_KEY);
    if (!accepted) {
      setVisible(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  };

  const handleAccept = async () => {
    await AsyncStorage.setItem(COOKIE_ACCEPTED_KEY, 'true');
    Animated.timing(slideAnim, {
      toValue: 200,
      duration: 400,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  };

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.content}>
        <View style={styles.iconBox}>
          <Ionicons name="information-circle-outline" size={24} color="#FFB81C" />
        </View>
        <Text style={styles.message}>{t('cookies.message')}</Text>
      </View>
      <TouchableOpacity style={styles.button} onPress={handleAccept}>
        <Text style={styles.buttonText}>{t('cookies.accept')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 90 : 20,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    zIndex: 9999,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Montserrat_500Medium',
  },
  button: {
    backgroundColor: '#FFB81C',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#FFB81C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
