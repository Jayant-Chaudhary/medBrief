import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import '../home/appointment_repository.dart';
import '../home/home_controller.dart';
import 'profile_controller.dart';
import 'profile_repository.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({
    super.key,
    required this.controller,
    required this.onSignOut,
    this.homeController,
    this.appointmentRepository,
  });

  final ProfileController controller;
  final VoidCallback onSignOut;
  final HomeController? homeController;
  final AppointmentRepository? appointmentRepository;

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

  late double _weight;
  late TextEditingController _weightCtrl;
  final FocusNode _weightFocus = FocusNode();
  bool _savingWeight = false;

  late TextEditingController _systolicCtrl;
  late TextEditingController _diastolicCtrl;
  final FocusNode _systolicFocus = FocusNode();
  final FocusNode _diastolicFocus = FocusNode();
  bool _savingBp = false;
  double? _lastSystolic;
  double? _lastDiastolic;

  @override
  void initState() {
    super.initState();
    _weight = widget.homeController?.vitals.weight?.value ?? 65.0;
    _weightCtrl = TextEditingController(text: _weight.toStringAsFixed(1));
    _lastSystolic = widget.homeController?.vitals.bpSystolic?.value;
    _lastDiastolic = widget.homeController?.vitals.bpDiastolic?.value;
    _systolicCtrl = TextEditingController(
      text: _lastSystolic != null ? _lastSystolic!.toInt().toString() : '',
    );
    _diastolicCtrl = TextEditingController(
      text: _lastDiastolic != null ? _lastDiastolic!.toInt().toString() : '',
    );

    if (widget.homeController == null && widget.appointmentRepository != null) {
      widget.appointmentRepository!.getLatestVitals().then((v) {
        if (mounted) {
          setState(() {
            if (v.weight?.value != null) {
              _weight = v.weight!.value;
              _weightCtrl.text = _weight.toStringAsFixed(1);
            }
            if (v.bpSystolic?.value != null) {
              _lastSystolic = v.bpSystolic!.value;
              _systolicCtrl.text = _lastSystolic!.toInt().toString();
            }
            if (v.bpDiastolic?.value != null) {
              _lastDiastolic = v.bpDiastolic!.value;
              _diastolicCtrl.text = _lastDiastolic!.toInt().toString();
            }
          });
        }
      }).catchError((_) {});
    }
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
    _weightCtrl.dispose();
    _weightFocus.dispose();
    _systolicCtrl.dispose();
    _diastolicCtrl.dispose();
    _systolicFocus.dispose();
    _diastolicFocus.dispose();
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _dobCtrl.dispose();
    _bloodCtrl.dispose();
    _addressCtrl.dispose();
    _emNameCtrl.dispose();
    _emPhoneCtrl.dispose();
    super.dispose();
  }

  void _stepWeight(double delta) {
    final current = double.tryParse(_weightCtrl.text) ?? _weight;
    final updated = double.parse((current + delta).clamp(10.0, 500.0).toStringAsFixed(1));
    setState(() {
      _weight = updated;
      _weightCtrl.text = updated.toStringAsFixed(1);
    });
  }

  Future<void> _saveWeight() async {
    _weightFocus.unfocus();
    final parsed = double.tryParse(_weightCtrl.text);
    if (parsed != null && parsed > 0) {
      _weight = parsed;
    }
    setState(() => _savingWeight = true);
    try {
      if (widget.homeController != null) {
        await widget.homeController!.logVitals(weight: _weight, logWeight: true);
      } else if (widget.appointmentRepository != null) {
        await widget.appointmentRepository!.logVital(
          metricKey: 'weight',
          value: _weight,
          unit: 'kg',
        );
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Weight logged: ${_weight.toStringAsFixed(1)} kg'),
            backgroundColor: primary,
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not save weight. Please try again.'),
            backgroundColor: Color(0xFFDC2626),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _savingWeight = false);
    }
  }

  Future<void> _saveBp() async {
    _systolicFocus.unfocus();
    _diastolicFocus.unfocus();
    final sys = double.tryParse(_systolicCtrl.text.trim());
    final dia = double.tryParse(_diastolicCtrl.text.trim());

    if (sys == null && dia == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter systolic and/or diastolic blood pressure.'),
          backgroundColor: Color(0xFFDC2626),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    setState(() => _savingBp = true);
    try {
      if (widget.homeController != null) {
        await widget.homeController!.logVitals(
          bpSystolic: sys,
          bpDiastolic: dia,
          logWeight: false,
        );
      } else if (widget.appointmentRepository != null) {
        if (sys != null) {
          await widget.appointmentRepository!.logVital(
            metricKey: 'blood_pressure_systolic',
            value: sys,
            unit: 'mmHg',
          );
        }
        if (dia != null) {
          await widget.appointmentRepository!.logVital(
            metricKey: 'blood_pressure_diastolic',
            value: dia,
            unit: 'mmHg',
          );
        }
      }

      if (mounted) {
        setState(() {
          if (sys != null) _lastSystolic = sys;
          if (dia != null) _lastDiastolic = dia;
        });
        final bpText =
            '${sys != null ? sys.toInt().toString() : '–'}/${dia != null ? dia.toInt().toString() : '–'} mmHg';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Blood pressure logged: $bpText'),
            backgroundColor: primary,
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not save blood pressure. Please try again.'),
            backgroundColor: Color(0xFFDC2626),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _savingBp = false);
    }
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

                // Weight Tracker Card
                _WeightCard(
                  weightController: _weightCtrl,
                  focusNode: _weightFocus,
                  saving: _savingWeight,
                  onDecrement: () => _stepWeight(-0.5),
                  onIncrement: () => _stepWeight(0.5),
                  onSave: _saveWeight,
                ),
                const SizedBox(height: 16),

                // Blood Pressure Tracker Card
                _BloodPressureCard(
                  systolicController: _systolicCtrl,
                  diastolicController: _diastolicCtrl,
                  systolicFocus: _systolicFocus,
                  diastolicFocus: _diastolicFocus,
                  lastSystolic: _lastSystolic,
                  lastDiastolic: _lastDiastolic,
                  saving: _savingBp,
                  onSave: _saveBp,
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

class _WeightCard extends StatelessWidget {
  const _WeightCard({
    required this.weightController,
    required this.focusNode,
    required this.saving,
    required this.onDecrement,
    required this.onIncrement,
    required this.onSave,
  });

  final TextEditingController weightController;
  final FocusNode focusNode;
  final bool saving;
  final VoidCallback onDecrement;
  final VoidCallback onIncrement;
  final VoidCallback onSave;

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
          const Row(
            children: [
              Icon(Icons.monitor_weight_outlined, size: 20, color: primary),
              SizedBox(width: 8),
              Text(
                'Weight Tracker',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ink,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Tap the weight to enter manually, or use - / + to adjust by 0.5 kg.',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFFBF8F5),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Expanded(
                  child: Text(
                    'Weight (kg)',
                    style: TextStyle(fontWeight: FontWeight.w600, color: ink),
                  ),
                ),
                _StepButton(
                  icon: Icons.remove,
                  onTap: saving ? null : onDecrement,
                ),
                const SizedBox(width: 8),
                Container(
                  width: 78,
                  height: 42,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: line),
                  ),
                  child: TextField(
                    controller: weightController,
                    focusNode: focusNode,
                    enabled: !saving,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _StepButton(
                  icon: Icons.add,
                  onTap: saving ? null : onIncrement,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonal(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFE4F0EF),
                foregroundColor: primary,
              ),
              onPressed: saving ? null : onSave,
              child: saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: primary,
                      ),
                    )
                  : const Text(
                      'Log weight',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: const Color(0xFFF3F4F6),
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.06),
                blurRadius: 4,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Icon(icon, size: 20, color: onTap == null ? muted : primary),
        ),
      );
}

class _BloodPressureCard extends StatelessWidget {
  const _BloodPressureCard({
    required this.systolicController,
    required this.diastolicController,
    required this.systolicFocus,
    required this.diastolicFocus,
    this.lastSystolic,
    this.lastDiastolic,
    required this.saving,
    required this.onSave,
  });

  final TextEditingController systolicController;
  final TextEditingController diastolicController;
  final FocusNode systolicFocus;
  final FocusNode diastolicFocus;
  final double? lastSystolic;
  final double? lastDiastolic;
  final bool saving;
  final VoidCallback onSave;

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
              const Icon(Icons.monitor_heart_outlined, size: 20, color: primary),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Blood Pressure Tracker',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: ink,
                  ),
                ),
              ),
              if (lastSystolic != null) ...[
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEDF5F4),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Last: ${lastSystolic!.toInt()}/${lastDiastolic?.toInt() ?? '–'} mmHg',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: primary,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Enter your systolic and diastolic readings (e.g. 120 / 80 mmHg).',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFBF8F5),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: line),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Systolic',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: muted,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: systolicController,
                              focusNode: systolicFocus,
                              enabled: !saving,
                              keyboardType: TextInputType.number,
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: ink,
                              ),
                              decoration: const InputDecoration(
                                hintText: '120',
                                border: InputBorder.none,
                                contentPadding: EdgeInsets.zero,
                                isDense: true,
                              ),
                            ),
                          ),
                          const Text(
                            'mmHg',
                            style: TextStyle(fontSize: 11, color: muted),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFBF8F5),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: line),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Diastolic',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: muted,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: diastolicController,
                              focusNode: diastolicFocus,
                              enabled: !saving,
                              keyboardType: TextInputType.number,
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: ink,
                              ),
                              decoration: const InputDecoration(
                                hintText: '80',
                                border: InputBorder.none,
                                contentPadding: EdgeInsets.zero,
                                isDense: true,
                              ),
                            ),
                          ),
                          const Text(
                            'mmHg',
                            style: TextStyle(fontSize: 11, color: muted),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonal(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFE4F0EF),
                foregroundColor: primary,
              ),
              onPressed: saving ? null : onSave,
              child: saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: primary,
                      ),
                    )
                  : const Text(
                      'Log blood pressure',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

