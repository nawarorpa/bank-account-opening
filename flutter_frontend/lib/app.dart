import 'package:flutter/material.dart';
import 'models/account_application.dart';
import 'screens/wizard_screen.dart';

class InvestorBankAccountApp extends StatelessWidget {
  const InvestorBankAccountApp({super.key});

  @override
  Widget build(BuildContext context) {
    const primary = Color(0xFF0B6B4B);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Investor Bank Account Opening',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: primary),
        scaffoldBackgroundColor: const Color(0xFFF5F7F6),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Color(0xFF16312A),
          elevation: 0,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFD7E0DC)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFD7E0DC)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: primary, width: 1.5),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
        ),
      ),
      home: WizardScreen(application: AccountApplication()),
    );
  }
}
