import 'package:flutter/material.dart';
import '../../core/app_theme.dart';
import '../home/appointment_repository.dart';
import 'checkin_controller.dart';
import 'checkin_repository.dart';

class CheckinPage extends StatefulWidget {
  const CheckinPage({
    super.key,
    required this.appointment,
    required this.repository,
    required this.onFinished,
  });

  final Appointment? appointment;
  final CheckinRepository repository;
  final VoidCallback onFinished;

  @override
  State<CheckinPage> createState() => _CheckinPageState();
}

class _CheckinPageState extends State<CheckinPage> {
  CheckinController? _controller;

  @override
  void initState() {
    super.initState();
    _initController();
  }

  @override
  void didUpdateWidget(covariant CheckinPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.appointment?.id != widget.appointment?.id) {
      _controller?.dispose();
      _initController();
    }
  }

  void _initController() {
    if (widget.appointment != null) {
      _controller = CheckinController(
        repo: widget.repository,
        appointmentId: widget.appointment!.id,
      );
      _controller!.load();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.appointment == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.event_busy_outlined, size: 48, color: muted),
              const SizedBox(height: 16),
              const Text(
                'No appointment selected',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: ink),
              ),
              const SizedBox(height: 8),
              const Text(
                'Please select an appointment from your Home tab before starting check-in.',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: widget.onFinished,
                child: const Text('Go to Home'),
              ),
            ],
          ),
        ),
      );
    }

    final controller = _controller!;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        if (controller.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }

        if (controller.stage == CheckinStage.error) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, size: 48, color: Color(0xFF9E543B)),
                  const SizedBox(height: 16),
                  Text(
                    controller.errorMessage ?? 'Could not load check-in.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: ink),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: controller.load,
                    child: const Text('Try again'),
                  ),
                ],
              ),
            ),
          );
        }

        return switch (controller.step) {
          CheckinStep.symptoms => _SymptomsStepView(controller: controller),
          CheckinStep.checklist => _ChecklistStepView(controller: controller),
          CheckinStep.done => _CheckinDoneView(onFinished: widget.onFinished),
        };
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Step 1: Symptoms Questionnaire View
// ---------------------------------------------------------------------------

class _SymptomsStepView extends StatelessWidget {
  const _SymptomsStepView({required this.controller});
  final CheckinController controller;

  @override
  Widget build(BuildContext context) {
    final questions = controller.questions;
    final allAnswered = controller.allSymptomsAnswered;
    final submitting = controller.isSubmitting;

    return Scaffold(
      backgroundColor: const Color(0xFFFBF8F5),
      body: SafeArea(
        child: Column(
          children: [
            const _StepIndicator(currentStep: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
                children: [
                  const Text(
                    'How are you feeling today?',
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      color: ink,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Your care team will review these answers before your visit begins.',
                    style: TextStyle(fontSize: 14, color: muted),
                  ),
                  const SizedBox(height: 20),

                  if (controller.errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFDF2EE),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        controller.errorMessage!,
                        style: const TextStyle(color: Color(0xFF9E543B), fontSize: 13),
                      ),
                    ),
                  ],

                  if (questions.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: line),
                      ),
                      child: const Column(
                        children: [
                          Icon(Icons.assignment_turned_in_outlined, size: 40, color: primary),
                          SizedBox(height: 12),
                          Text(
                            'No pre-visit questions',
                            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: ink),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Your clinician has no symptoms questions for this visit. You can continue straight to your checklist.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: muted, fontSize: 13),
                          ),
                        ],
                      ),
                    )
                  else
                    ...questions.map(
                      (q) => _QuestionCard(
                        question: q,
                        answer: controller.answers[q.id],
                        onYesNoSelected: (val) => controller.setYesNo(q.id, val),
                        onNotesChanged: (val) => controller.setNotes(q.id, val),
                        onTextChanged: (val) => controller.setText(q.id, val),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomSheet: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: line.withValues(alpha: 0.5))),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 10,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: SafeArea(
          child: FilledButton(
            onPressed: allAnswered && !submitting
                ? controller.saveSymptomsAndContinue
                : null,
            child: submitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(allAnswered ? 'Continue to Checklist' : 'Please answer all questions'),
          ),
        ),
      ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.question,
    required this.answer,
    required this.onYesNoSelected,
    required this.onNotesChanged,
    required this.onTextChanged,
  });

  final QuestionTemplate question;
  final UserAnswer? answer;
  final ValueChanged<String> onYesNoSelected;
  final ValueChanged<String> onNotesChanged;
  final ValueChanged<String> onTextChanged;

  @override
  Widget build(BuildContext context) {
    final isYes = answer?.value == 'yes';
    final isNo = answer?.value == 'no';

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
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
          Text(
            question.questionText,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: ink,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 14),

          if (question.isText) ...[
            TextFormField(
              initialValue: answer?.text ?? '',
              maxLines: 3,
              onChanged: onTextChanged,
              decoration: const InputDecoration(
                hintText: 'Type your answer here…',
                hintStyle: TextStyle(color: muted, fontSize: 14),
              ),
            ),
          ] else ...[
            // Yes / No selection chips
            Row(
              children: [
                Expanded(
                  child: _OptionChip(
                    label: 'Yes',
                    selected: isYes,
                    onTap: () => onYesNoSelected('yes'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _OptionChip(
                    label: 'No',
                    selected: isNo,
                    onTap: () => onYesNoSelected('no'),
                  ),
                ),
              ],
            ),

            // Expandable details input on "Yes"
            if (isYes) ...[
              const SizedBox(height: 14),
              AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Please provide a few details:',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      initialValue: answer?.notes ?? '',
                      maxLines: 2,
                      onChanged: onNotesChanged,
                      decoration: const InputDecoration(
                        hintText: 'E.g., It started 2 days ago, mild in the morning…',
                        hintStyle: TextStyle(color: muted, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _OptionChip extends StatelessWidget {
  const _OptionChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? primary : const Color(0xFFFBF8F5),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? primary : line,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : ink,
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Step 2: Pre-Visit Checklist View
// ---------------------------------------------------------------------------

class _ChecklistStepView extends StatelessWidget {
  const _ChecklistStepView({required this.controller});
  final CheckinController controller;

  @override
  Widget build(BuildContext context) {
    final items = controller.checklist;
    final submitting = controller.isSubmitting;

    return Scaffold(
      backgroundColor: const Color(0xFFFBF8F5),
      body: SafeArea(
        child: Column(
          children: [
            const _StepIndicator(currentStep: 2),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
                children: [
                  Row(
                    children: [
                      IconButton(
                        onPressed: controller.backToSymptoms,
                        icon: const Icon(Icons.arrow_back_rounded, color: ink),
                        tooltip: 'Back to symptoms',
                      ),
                      const SizedBox(width: 4),
                      const Expanded(
                        child: Text(
                          'Pre-Visit Checklist',
                          style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: ink,
                            letterSpacing: -0.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Padding(
                    padding: EdgeInsets.only(left: 48),
                    child: Text(
                      'Please ensure you have these items ready for your visit today.',
                      style: TextStyle(fontSize: 14, color: muted),
                    ),
                  ),
                  const SizedBox(height: 24),

                  if (controller.errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFDF2EE),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        controller.errorMessage!,
                        style: const TextStyle(color: Color(0xFF9E543B), fontSize: 13),
                      ),
                    ),
                  ],

                  if (items.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: line),
                      ),
                      child: const Column(
                        children: [
                          Icon(Icons.check_circle_outline, size: 40, color: primary),
                          SizedBox(height: 12),
                          Text(
                            'No preparation items required',
                            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: ink),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'You do not have any specific preparation items for this visit. Tap below to complete check-in.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: muted, fontSize: 13),
                          ),
                        ],
                      ),
                    )
                  else
                    ...items.map(
                      (item) => _ChecklistCard(
                        item: item,
                        onToggle: () => controller.toggleChecklistItem(item),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomSheet: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: line.withValues(alpha: 0.5))),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 10,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: SafeArea(
          child: FilledButton(
            onPressed: submitting ? null : controller.completeCheckin,
            child: submitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Complete check-in'),
          ),
        ),
      ),
    );
  }
}

class _ChecklistCard extends StatelessWidget {
  const _ChecklistCard({required this.item, required this.onToggle});

  final ChecklistItem item;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onToggle,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: item.isCompleted ? const Color(0xFFF4F8F7) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: item.isCompleted ? const Color(0xFFB2D4CF) : line,
            width: item.isCompleted ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: item.isCompleted ? primary : Colors.transparent,
                shape: BoxShape.circle,
                border: Border.all(
                  color: item.isCompleted ? primary : muted,
                  width: 2,
                ),
              ),
              child: item.isCompleted
                  ? const Icon(Icons.check, size: 16, color: Colors.white)
                  : null,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: item.isCompleted ? muted : ink,
                      decoration: item.isCompleted
                          ? TextDecoration.lineThrough
                          : TextDecoration.none,
                    ),
                  ),
                  if (item.isAiGenerated) ...[
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8F3F1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'Report follow-up',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: primary,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Step 3: Check-in Done View
// ---------------------------------------------------------------------------

class _CheckinDoneView extends StatelessWidget {
  const _CheckinDoneView({required this.onFinished});
  final VoidCallback onFinished;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFBF8F5),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Center(
            child: SingleChildScrollView(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 90,
                    height: 90,
                    decoration: const BoxDecoration(
                      color: Color(0xFFE8F3F1),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.check_circle_rounded,
                      color: primary,
                      size: 60,
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'You’re all set!',
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      color: ink,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Your check-in is complete. The care team has received your questionnaire responses.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 15, color: muted, height: 1.5),
                  ),
                  const SizedBox(height: 28),
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: line),
                    ),
                    child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.info_outline_rounded, color: primary, size: 20),
                            SizedBox(width: 8),
                            Text(
                              'What happens next?',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: ink,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 10),
                        Text(
                          'Please arrive at the clinic 10 minutes before your scheduled appointment time. Bring the physical copies of the items from your checklist.',
                          style: TextStyle(fontSize: 14, color: muted, height: 1.5),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 36),
                  FilledButton(
                    onPressed: onFinished,
                    child: const Text('Back to Dashboard'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Step Progress Indicator
// ---------------------------------------------------------------------------

class _StepIndicator extends StatelessWidget {
  const _StepIndicator({required this.currentStep});
  final int currentStep; // 1 or 2

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: line.withValues(alpha: 0.6))),
      ),
      child: Row(
        children: [
          _StepPill(number: 1, title: 'Symptoms', active: currentStep >= 1),
          const Expanded(
            child: Divider(color: line, thickness: 1.5, indent: 8, endIndent: 8),
          ),
          _StepPill(number: 2, title: 'Checklist', active: currentStep >= 2),
        ],
      ),
    );
  }
}

class _StepPill extends StatelessWidget {
  const _StepPill({
    required this.number,
    required this.title,
    required this.active,
  });

  final int number;
  final String title;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 26,
          height: 26,
          decoration: BoxDecoration(
            color: active ? primary : const Color(0xFFF3F4F6),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              '$number',
              style: TextStyle(
                color: active ? Colors.white : muted,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          title,
          style: TextStyle(
            fontSize: 13,
            fontWeight: active ? FontWeight.w700 : FontWeight.w500,
            color: active ? ink : muted,
          ),
        ),
      ],
    );
  }
}

