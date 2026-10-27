import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import 'profile_controller.dart';
import 'profile_repository.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({
    super.key,
    required this.controller,
    required this.onSignOut,
  });

  final ProfileController controller;
  final VoidCallback onSignOut;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _nameCtrl;
  late TextEditingController _phoneCtrl;
  late TextEditingController _dobCtrl;
  late TextEditingController _bloodCtrl;
  late TextEditingController _addressCtrl;
  late TextEditingController _emNameCtrl;
  late TextEditingController _emPhoneCtrl;

  @override
  void initState() {
    super.initState();
    _initControllers();
    widget.controller.load().then((_) {
      if (mounted) _syncControllers();
    });
  }

  void _initControllers() {
    _nameCtrl = TextEditingController();
    _phoneCtrl = TextEditingController();
    _dobCtrl = TextEditingController();
    _bloodCtrl = TextEditingController();
    _addressCtrl = TextEditingController();
    _emNameCtrl = TextEditingController();
    _emPhoneCtrl = TextEditingController();
  }

  void _syncControllers() {
    final p = widget.controller.profile;
    if (p != null) {
      _nameCtrl.text = p.fullName;
      _phoneCtrl.text = p.phone ?? '';
      _dobCtrl.text = p.dateOfBirth ?? '';
      _bloodCtrl.text = p.bloodType ?? '';
      _addressCtrl.text = p.address ?? '';
      _emNameCtrl.text = p.emergencyContactName ?? '';
      _emPhoneCtrl.text = p.emergencyContactPhone ?? '';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _dobCtrl.dispose();
    _bloodCtrl.dispose();
    _addressCtrl.dispose();
    _emNameCtrl.dispose();
    _emPhoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleSave() async {
    if (!_formKey.currentState!.validate()) return;

    final updated = PatientProfileData(
      fullName: _nameCtrl.text.trim(),
      phone: _phoneCtrl.text.trim().isEmpty ? null : _phoneCtrl.text.trim(),
      dateOfBirth: _dobCtrl.text.trim().isEmpty ? null : _dobCtrl.text.trim(),
      bloodType: _bloodCtrl.text.trim().isEmpty ? null : _bloodCtrl.text.trim(),
      address: _addressCtrl.text.trim().isEmpty ? null : _addressCtrl.text.trim(),
      emergencyContactName:
          _emNameCtrl.text.trim().isEmpty ? null : _emNameCtrl.text.trim(),
      emergencyContactPhone:
          _emPhoneCtrl.text.trim().isEmpty ? null : _emPhoneCtrl.text.trim(),
    );

    final success = await widget.controller.save(updated);
    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile saved successfully.'),
          backgroundColor: primary,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _confirmSignOut() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text(
          'Are you sure you want to sign out of your account on this device?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            onPressed: () {
              Navigator.pop(ctx);
              widget.onSignOut();
            },
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;

        if (controller.isLoading && controller.profile == null) {
          return const Center(child: CircularProgressIndicator());
        }

        final initial = _nameCtrl.text.isNotEmpty
            ? _nameCtrl.text[0].toUpperCase()
            : 'P';

        return RefreshIndicator(
          onRefresh: () async {
            await controller.load();
            _syncControllers();
          },
          color: primary,
          child: Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              children: [
                // Header Profile Card
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: line),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.02),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 28,
                        backgroundColor: primary,
                        child: Text(
                          initial,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _nameCtrl.text.isNotEmpty
                                  ? _nameCtrl.text
                                  : 'Your Profile',
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: ink,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFEDF5F4),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text(
                                'Patient Account',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: primary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                // Error feedback
                if (controller.errorMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFFCA5A5)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: Color(0xFFDC2626), size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            controller.errorMessage!,
                            style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],

                // Personal Details Card
                _FormSection(
                  title: 'Personal Details',
                  icon: Icons.person_outline_rounded,
                  children: [
                    TextFormField(
                      controller: _nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Full name',
                        hintText: 'Jane Doe',
                      ),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Full name is required';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _phoneCtrl,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                        labelText: 'Phone number',
                        hintText: '+1 555-0100',
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _dobCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Date of birth (YYYY-MM-DD)',
                        hintText: '1990-05-15',
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _addressCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Address',
                        hintText: '123 Medical Way',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Health Details Card
                _FormSection(
                  title: 'Health',
                  icon: Icons.favorite_border_rounded,
                  children: [
                    TextFormField(
                      controller: _bloodCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Blood type',
                        hintText: 'O+, A+, B+, AB-',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Emergency Contact Card
                _FormSection(
                  title: 'Emergency Contact',
                  icon: Icons.contact_phone_outlined,
                  children: [
                    TextFormField(
                      controller: _emNameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Contact name',
                        hintText: 'Emergency contact full name',
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _emPhoneCtrl,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                        labelText: 'Contact phone',
                        hintText: 'Emergency phone number',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Save Changes Button
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: FilledButton.icon(
                    onPressed: controller.isSaving ? null : _handleSave,
                    icon: controller.isSaving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.save_outlined, size: 18),
                    label: Text(
                      controller.isSaving ? 'Saving…' : 'Save Changes',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Sign Out Button
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFDC2626),
                      side: const BorderSide(color: Color(0xFFFCA5A5)),
                    ),
                    onPressed: _confirmSignOut,
                    icon: const Icon(Icons.logout_rounded, size: 18),
                    label: const Text(
                      'Sign Out',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _FormSection extends StatelessWidget {
  const _FormSection({
    required this.title,
    required this.icon,
    required this.children,
  });

  final String title;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: line),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: primary),
              const SizedBox(width: 8),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ink,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }
}

