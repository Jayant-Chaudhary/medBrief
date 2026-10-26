import 'package:flutter/material.dart';

import '../../core/app_theme.dart';

class AuthFrame extends StatelessWidget {
  const AuthFrame({super.key, required this.children, this.showBack = false});
  final List<Widget> children;
  final bool showBack;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: showBack ? AppBar() : null,
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 28),
          child: AutofillGroup(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class BrandHeader extends StatelessWidget {
  const BrandHeader({super.key});

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 48,
        height: 48,
        padding: const EdgeInsets.all(7),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: line),
        ),
        child: Image.asset('assets/logo-mark.png', excludeFromSemantics: true),
      ),
      const SizedBox(width: 12),
      const Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'MedBrief',
              style: TextStyle(
                color: primary,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              'YOUR CARE, CONNECTED',
              style: TextStyle(color: muted, fontSize: 10, letterSpacing: 1.4),
            ),
          ],
        ),
      ),
    ],
  );
}

class ErrorNotice extends StatelessWidget {
  const ErrorNotice(this.message, {super.key});
  final String? message;

  @override
  Widget build(BuildContext context) {
    if (message == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 20),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFFDF2EE),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(message!, style: const TextStyle(color: Color(0xFF9E543B))),
      ),
    );
  }
}

class PasswordInput extends StatefulWidget {
  const PasswordInput({
    super.key,
    required this.controller,
    this.label = 'Password',
    this.validator,
    this.onSubmitted,
    this.newPassword = false,
    this.enabled = true,
  });
  final TextEditingController controller;
  final String label;
  final String? Function(String?)? validator;
  final VoidCallback? onSubmitted;
  final bool newPassword;
  final bool enabled;

  @override
  State<PasswordInput> createState() => _PasswordInputState();
}

class _PasswordInputState extends State<PasswordInput> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: widget.controller,
    enabled: widget.enabled,
    obscureText: _hidden,
    autocorrect: false,
    enableSuggestions: false,
    autofillHints: [
      widget.newPassword ? AutofillHints.newPassword : AutofillHints.password,
    ],
    textInputAction: TextInputAction.done,
    onFieldSubmitted: (_) => widget.onSubmitted?.call(),
    validator: widget.validator,
    decoration: InputDecoration(
      labelText: widget.label,
      prefixIcon: const Icon(Icons.lock_outline_rounded, size: 21),
      suffixIcon: IconButton(
        tooltip: _hidden ? 'Show password' : 'Hide password',
        onPressed: widget.enabled
            ? () => setState(() => _hidden = !_hidden)
            : null,
        icon: Icon(
          _hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
        ),
      ),
    ),
  );
}

String? validateEmail(String? value) {
  if (value == null || value.trim().isEmpty) return 'Enter your email address.';
  if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value.trim())) {
    return 'Enter a valid email address.';
  }
  return null;
}

Widget buttonLabel(String label, bool busy) => busy
    ? const SizedBox(
        width: 22,
        height: 22,
        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
      )
    : Text(label);
