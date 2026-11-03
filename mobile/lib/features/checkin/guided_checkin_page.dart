import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/app_theme.dart';
import 'checkin_repository.dart';
import 'prenatal_questions.dart';

class GuidedCheckinPage extends StatefulWidget {
  const GuidedCheckinPage({
    super.key,
    this.appointmentId,
    this.gestationalWeek,
    required this.repository,
    this.emergencyContactPhone,
    required this.onCompleted,
    this.onCancel,
  });

  final String? appointmentId;
  final int? gestationalWeek;
  final CheckinRepository repository;
  final String? emergencyContactPhone;
  final VoidCallback onCompleted;
  final VoidCallback? onCancel;

  @override
  State<GuidedCheckinPage> createState() => _GuidedCheckinPageState();
}

class _GuidedCheckinPageState extends State<GuidedCheckinPage> {
  late final List<PrenatalCheckinQuestion> _questions;
  int _currentIndex = 0;

  final Map<String, dynamic> _answers = {};
  final Map<String, String> _notes = {};
  final Set<String> _flaggedKeys = {};

  bool _isSubmitting = false;
  String? _errorMessage;
  bool _completed = false;
  bool _hasRedFlagAlert = false;

  @override
  void initState() {
    super.initState();
    _questions = PrenatalQuestionsBank.forGestationalWeek(widget.gestationalWeek);
  }

  PrenatalCheckinQuestion? get _currentQuestion =>
      _currentIndex < _questions.length ? _questions[_currentIndex] : null;

  void _onAnswerBoolean(bool value) {
    final q = _currentQuestion;
    if (q == null) return;

    setState(() {
      _answers[q.key] = value;
      final isFlag = q.isRedFlagTrigger && (value == q.flagIfTrue);
      if (isFlag) {
        _flaggedKeys.add(q.key);
        _hasRedFlagAlert = true;
      } else {
        _flaggedKeys.remove(q.key);
      }
    });

    if (q.isRedFlagTrigger && (value == q.flagIfTrue)) {
      _showEmergencyIntercept(q);
    }
  }

  void _onAnswerScale(int value) {
    final q = _currentQuestion;
    if (q == null) return;

    setState(() {
      _answers[q.key] = value;
    });
  }

  void _showEmergencyIntercept(PrenatalCheckinQuestion question) {
    showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Container(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFBECE8),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.warning_amber_rounded,
                      color: Color(0xFF9E543B),
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Text(
                      'Important Clinical Alert',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: ink,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Text(
                'The symptom you just reported is an obstetric red flag that warrants prompt evaluation by a clinician.',
                style: TextStyle(fontSize: 15, color: ink, height: 1.4),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFBF8F5),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: line),
                ),
                child: Text(
                  widget.emergencyContactPhone != null
                      ? 'Triage / Emergency contact: ${widget.emergencyContactPhone}'
                      : 'Please call your maternity triage unit or doctor immediately.',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: ink,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(double.infinity, 50),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Continue Check-in'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  void _next() {
    if (_currentIndex < _questions.length - 1) {
      setState(() {
        _currentIndex++;
      });
    } else {
      _submit();
    }
  }

  void _previous() {
    if (_currentIndex > 0) {
      setState(() {
        _currentIndex--;
      });
    }
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final payloadList = <CheckinAnswerPayload>[];

    for (final q in _questions) {
      final ans = _answers[q.key];
      final note = _notes[q.key];
      final isFlag = _flaggedKeys.contains(q.key);

      String categoryStr = 'physical';
      if (q.dimension == CheckinDimension.mental) {
        categoryStr = 'mental';
      } else if (q.dimension == CheckinDimension.medical) {
        categoryStr = 'medical';
      }

      bool? boolVal;
      int? scaleVal;
      String? textVal = note;

      if (q.answerType == 'boolean') {
        boolVal = ans as bool?;
      } else if (q.answerType == 'scale') {
        scaleVal = ans as int?;
      } else if (q.answerType == 'text') {
        textVal = (ans as String?) ?? note;
      }

      payloadList.add(
        CheckinAnswerPayload(
          category: categoryStr,
          questionKey: q.key,
          questionText: q.prompt,
          answerType: q.answerType,
          boolValue: boolVal,
          scaleValue: scaleVal,
          textValue: textVal,
          isRedFlag: isFlag,
        ),
      );
    }

    try {
      await widget.repository.submitPeriodicCheckin(
        appointmentId: widget.appointmentId,
        sessionType: widget.appointmentId != null ? 'pre_visit' : 'routine_weekly',
        gestationalWeek: widget.gestationalWeek,
        answers: payloadList,
      );

      setState(() {
        _isSubmitting = false;
        _completed = true;
      });
    } on AppException catch (e) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = e.message;
      });
    } catch (_) {
      setState(() {
        _isSubmitting = false;
        _errorMessage = 'Could not save check-in. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_completed) {
      return Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.close),
            onPressed: widget.onCompleted,
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: _hasRedFlagAlert
                        ? const Color(0xFFFBECE8)
                        : const Color(0xFFE8F3F1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    _hasRedFlagAlert
                        ? Icons.warning_rounded
                        : Icons.check_circle_rounded,
                    color: _hasRedFlagAlert
                        ? const Color(0xFF9E543B)
                        : primary,
                    size: 40,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  _hasRedFlagAlert ? 'Check-in Recorded' : 'All done!',
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: ink,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  _hasRedFlagAlert
                      ? 'You reported one or more priority symptoms. Your clinician will be alerted, and please reach out to triage if symptoms persist.'
                      : 'Your responses have been recorded. Our clinical assistant will prepare a pre-visit summary for your doctor.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 15, color: muted, height: 1.4),
                ),
                const SizedBox(height: 32),
                FilledButton(
                  onPressed: widget.onCompleted,
                  child: const Text('Back to Home'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final q = _currentQuestion;
    if (q == null) return const SizedBox.shrink();

    final progress = (_currentIndex + 1) / _questions.length;
    final currentAnswer = _answers[q.key];

    return Scaffold(
      appBar: AppBar(
        leading: _currentIndex > 0
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: _previous,
              )
            : IconButton(
                icon: const Icon(Icons.close),
                onPressed: widget.onCancel ?? () => Navigator.of(context).pop(),
              ),
        title: Text(
          widget.gestationalWeek != null
              ? 'Week ${widget.gestationalWeek} Check-In'
              : 'Prenatal Check-In',
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            LinearProgressIndicator(
              value: progress,
              backgroundColor: line,
              color: primary,
              minHeight: 4,
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Question ${_currentIndex + 1} of ${_questions.length}',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: muted,
                    ),
                  ),
                  _DimensionChip(dimension: q.dimension),
                ],
              ),
            ),
            if (_errorMessage != null)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFBECE8),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _errorMessage!,
                  style: const TextStyle(color: Color(0xFF9E543B), fontSize: 13),
                ),
              ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                children: [
                  Text(
                    q.title,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: ink,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    q.prompt,
                    style: const TextStyle(
                      fontSize: 16,
                      color: ink,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 28),
                  if (q.answerType == 'boolean') ...[
                    Row(
                      children: [
                        Expanded(
                          child: _ChoiceButton(
                            label: 'Yes',
                            isSelected: currentAnswer == true,
                            onTap: () => _onAnswerBoolean(true),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: _ChoiceButton(
                            label: 'No',
                            isSelected: currentAnswer == false,
                            onTap: () => _onAnswerBoolean(false),
                          ),
                        ),
                      ],
                    ),
                  ] else if (q.answerType == 'scale') ...[
                    _ScaleSelector(
                      value: currentAnswer as int?,
                      minLabel: q.scaleMinLabel,
                      maxLabel: q.scaleMaxLabel,
                      onChanged: _onAnswerScale,
                    ),
                  ] else if (q.answerType == 'text') ...[
                    TextField(
                      maxLines: 4,
                      decoration: const InputDecoration(
                        hintText: 'Type any details or questions here...',
                      ),
                      onChanged: (text) {
                        setState(() {
                          _answers[q.key] = text;
                        });
                      },
                    ),
                  ],
                  const SizedBox(height: 24),
                  if (q.answerType != 'text') ...[
                    ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      title: const Text(
                        'Add optional note or details',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: primary,
                        ),
                      ),
                      children: [
                        TextField(
                          maxLines: 2,
                          decoration: const InputDecoration(
                            hintText: 'e.g. noticed this since Tuesday morning...',
                          ),
                          onChanged: (text) {
                            _notes[q.key] = text;
                          },
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: line)),
              ),
              child: FilledButton(
                onPressed: _isSubmitting || currentAnswer == null && q.answerType != 'text'
                    ? null
                    : _next,
                child: _isSubmitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Text(
                        _currentIndex == _questions.length - 1
                            ? 'Complete Check-In'
                            : 'Next Question',
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChoiceButton extends StatelessWidget {
  const _ChoiceButton({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        height: 64,
        decoration: BoxDecoration(
          color: isSelected ? primary : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isSelected ? primary : line,
            width: isSelected ? 2 : 1,
          ),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: isSelected ? Colors.white : ink,
          ),
        ),
      ),
    );
  }
}

class _ScaleSelector extends StatelessWidget {
  const _ScaleSelector({
    required this.value,
    required this.minLabel,
    required this.maxLabel,
    required this.onChanged,
  });

  final int? value;
  final String minLabel;
  final String maxLabel;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: List.generate(5, (index) {
            final score = index + 1;
            final isSelected = value == score;
            return InkWell(
              onTap: () => onChanged(score),
              borderRadius: BorderRadius.circular(14),
              child: Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: isSelected ? primary : Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: isSelected ? primary : line,
                    width: isSelected ? 2 : 1,
                  ),
                ),
                alignment: Alignment.center,
                child: Text(
                  '$score',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: isSelected ? Colors.white : ink,
                  ),
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 10),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(minLabel, style: const TextStyle(fontSize: 12, color: muted)),
            Text(maxLabel, style: const TextStyle(fontSize: 12, color: muted)),
          ],
        ),
      ],
    );
  }
}

class _DimensionChip extends StatelessWidget {
  const _DimensionChip({required this.dimension});

  final CheckinDimension dimension;

  @override
  Widget build(BuildContext context) {
    String label = 'Physical';
    Color bg = const Color(0xFFE8F3F1);
    Color fg = primary;

    if (dimension == CheckinDimension.mental) {
      label = 'Emotional';
      bg = const Color(0xFFF3E8F5);
      fg = const Color(0xFF732E8A);
    } else if (dimension == CheckinDimension.medical) {
      label = 'Routine';
      bg = const Color(0xFFE8EFF9);
      fg = const Color(0xFF2C63A6);
    } else if (dimension == CheckinDimension.agenda) {
      label = 'Doctor Notes';
      bg = const Color(0xFFFFF7E6);
      fg = const Color(0xFFB37400);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: fg),
      ),
    );
  }
}

