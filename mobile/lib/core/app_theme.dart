import 'package:flutter/material.dart';

const primary = Color(0xFF2F6F6B);
const canvas = Color(0xFFFBF8F5);
const ink = Color(0xFF1F2933);
const muted = Color(0xFF6B7280);
const line = Color(0xFFEAE3D6);

ThemeData buildTheme() => ThemeData(
  useMaterial3: true,
  fontFamily: 'Roboto',
  scaffoldBackgroundColor: canvas,
  colorScheme: ColorScheme.fromSeed(
    seedColor: primary,
    primary: primary,
    surface: canvas,
    error: const Color(0xFF9E543B),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: canvas,
    foregroundColor: ink,
    elevation: 0,
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: primary, width: 2),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(double.infinity, 56),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      textStyle: const TextStyle(
        fontFamily: 'Roboto',
        fontSize: 16,
        fontWeight: FontWeight.w700,
      ),
    ),
  ),
);
