import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { MAP_STYLE_URL } from '../constants/mapbox';

type LatLng = { lat: number; lng: number };

interface Props {
  visible: boolean;
  userPosition: LatLng;
  destination: LatLng | null;
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
}

/**
 * Full-screen map for choosing a destination. It lives outside the New Journey
 * ScrollView, so pans and pinches always go to the map. The chosen point only
 * becomes the destination when the user confirms.
 */
export function DestinationPickerModal({ visible, userPosition, destination, onConfirm, onCancel }: Props) {
  const [pending, setPending] = useState<LatLng | null>(destination);

  // Each opening starts from the current destination, not a leftover choice.
  useEffect(() => {
    if (visible) setPending(destination);
  }, [visible, destination]);

  const center = pending ?? destination ?? userPosition;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerText}>Tap the map to set your destination</Text>
          <Pressable onPress={onCancel} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        <Mapbox.MapView
          testID="destinationPickerMap"
          style={styles.map}
          styleURL={MAP_STYLE_URL}
          onPress={(e: any) => {
            const [lng, lat] = e.geometry.coordinates as [number, number];
            setPending({ lat, lng });
          }}
        >
          <Mapbox.Camera defaultSettings={{ centerCoordinate: [center.lng, center.lat], zoomLevel: 13 }} />
          <Mapbox.UserLocation />
          {pending && (
            <Mapbox.PointAnnotation id="pickerDestination" coordinate={[pending.lng, pending.lat]}>
              <View style={styles.pin} />
            </Mapbox.PointAnnotation>
          )}
        </Mapbox.MapView>

        <Pressable
          style={[styles.confirmButton, !pending && styles.confirmDisabled]}
          disabled={!pending}
          onPress={() => {
            if (pending) onConfirm(pending.lat, pending.lng);
          }}
        >
          <Text style={styles.confirmText}>Use this destination</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 12,
  },
  headerText: { color: '#e5e7eb', flex: 1 },
  cancelButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#374151', borderRadius: 8 },
  cancelText: { color: '#e5e7eb', fontWeight: '600' },
  map: { flex: 1 },
  pin: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', borderWidth: 2, borderColor: '#fff' },
  confirmButton: { backgroundColor: '#10b981', padding: 16, margin: 16, borderRadius: 10 },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
