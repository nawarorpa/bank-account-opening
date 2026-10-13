
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../models/account_application.dart';
import '../services/api_service.dart';
import '../widgets/app_field.dart';
import '../widgets/section_card.dart';

class WizardScreen extends StatefulWidget {
  const WizardScreen({
    super.key,
    required this.application,
  });

  final AccountApplication application;

  @override
  State<WizardScreen> createState() => _WizardScreenState();
}

class _WizardScreenState extends State<WizardScreen> {
  final _formKey = GlobalKey<FormState>();
  final _api = ApiService();

  int _step = 0;
  bool _submitting = false;
  String? _applicationId;
  bool _sameAddress = false;
  bool _declarationAccepted = false;
  bool _submitted = false;
  String? _submittedApplicationNumber;
  String _submittedStatus = 'SUBMITTED';

  static const String _aiblBranchesUrl =
      'https://www.aibl.com.bd/branches/';

  List<String> _branchNames = const [];
  bool _loadingBranches = true;

  final List<String> _steps = const [
    'General & Company',
    'Trade, Tax & Office',
    'Account',
    'Operating Person',
    'Documents & Declaration',
  ];

  final List<_DocumentRequirement> _documents = const [
    _DocumentRequirement('Certificate of Incorporation', true),
    _DocumentRequirement('Memorandum of Article and Association', true),
    _DocumentRequirement('TIN Certificate', true),
    _DocumentRequirement('Trade License', true),
    _DocumentRequirement(
      'National ID Card – Account Operating Person',
      true,
    ),
    _DocumentRequirement(
      'Board Resolution / Authorization Letter',
      false,
    ),
    _DocumentRequirement(
      'BIDA Registration Certificate',
      false,
    ),
  ];

  Map<String, dynamic> get _data => widget.application.data;

  void _set(String key, dynamic value) {
    _data[key] = value;
  }

  @override
  void initState() {
    super.initState();
    _loadAiblBranches();
  }

  Future<void> _loadAiblBranches() async {
    try {
      final response = await http.get(Uri.parse(_aiblBranchesUrl));

      if (response.statusCode != 200) {
        throw Exception('HTTP ${response.statusCode}');
      }

      final matches = RegExp(
        r'<h3[^>]*>([\s\S]*?)</h3>',
        caseSensitive: false,
      ).allMatches(response.body);

      final names = <String>{};

      for (final match in matches) {
        var name = match.group(1) ?? '';

        name = name.replaceAll(RegExp(r'<[^>]+>'), ' ');
        name = name
            .replaceAll('&amp;', '&')
            .replaceAll('&nbsp;', ' ')
            .replaceAll('&quot;', '"')
            .replaceAll('&#39;', "'")
            .replaceAll('&apos;', "'")
            .replaceAll(RegExp(r'\s+'), ' ')
            .trim();

        if (name.isEmpty) continue;

        final lower = name.toLowerCase();
        if (lower == 'branches' ||
            lower == 'sub branch' ||
            lower.contains('find a branch')) {
          continue;
        }

        names.add(name);
      }

      final sortedNames = names.toList()..sort();

      if (!mounted) return;

      setState(() {
        _branchNames = sortedNames;
        _loadingBranches = false;
      });
    } catch (_) {
      if (!mounted) return;

      setState(() {
        _branchNames = const [];
        _loadingBranches = false;
      });

      _show(
        'Unable to load AIBL branch list. Please check your internet connection and try again.',
      );
    }
  }

  Future<void> _pickDate(String key) async {
    final now = DateTime.now();
    final isDob = key == 'dateOfBirth';

    final maximumDate = isDob
        ? DateTime(now.year - 18, now.month, now.day)
        : DateTime(2100);

    DateTime initialDate = now;

    final existing = _parseDate(_data[key]?.toString());
    if (existing != null) {
      initialDate = existing;
    } else if (isDob) {
      initialDate = DateTime(
        maximumDate.year - 1,
        maximumDate.month,
        maximumDate.day,
      );
    }

    if (initialDate.isAfter(maximumDate)) {
      initialDate = maximumDate;
    }

    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(1900),
      lastDate: maximumDate,
      initialDate: initialDate,
    );

    if (picked == null || !mounted) return;

    _data[key] =
        '${picked.day.toString().padLeft(2, '0')}-'
        '${picked.month.toString().padLeft(2, '0')}-'
        '${picked.year}';

    setState(() {});
  }

  DateTime? _parseDate(String? value) {
    if (value == null || value.trim().isEmpty) {
      return null;
    }

    final match = RegExp(
      r'^(\d{2})-(\d{2})-(\d{4})$',
    ).firstMatch(value.trim());

    if (match == null) {
      return null;
    }

    final day = int.tryParse(match.group(1)!);
    final month = int.tryParse(match.group(2)!);
    final year = int.tryParse(match.group(3)!);

    if (day == null || month == null || year == null) {
      return null;
    }

    final date = DateTime(year, month, day);

    if (date.year != year ||
        date.month != month ||
        date.day != day) {
      return null;
    }

    return date;
  }

  bool _isValidTin(String value) {
    return RegExp(r'^\d{12}$').hasMatch(value.trim());
  }

  bool _isValidNid(String value) {
    final trimmed = value.trim();
    return RegExp(r'^\d+$').hasMatch(trimmed) &&
        const {10, 13, 17}.contains(trimmed.length);
  }

  bool _isValidMobile(String value) {
    return RegExp(r'^0\d{10}$').hasMatch(value.trim());
  }

  bool _isValidEmail(String value) {
    final email = value.trim();

    if (email.isEmpty || email.length > 254) {
      return false;
    }

    final pattern = RegExp(
      r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$',
    );

    return pattern.hasMatch(email);
  }

  bool _isBanglaOnly(String value) {
    final text = value.trim();

    if (text.isEmpty) {
      return false;
    }

    return RegExp(r'^[\u0980-\u09FF\s]+$').hasMatch(text);
  }

  String _digitsOnly(String value) {
    return value.replaceAll(RegExp(r'[^0-9]'), '');
  }

  bool _validateCustomFields() {
    String? message;

    final tradeLicenseNumber =
        _data['tradeLicenseNumber']?.toString().trim() ?? '';
    if (tradeLicenseNumber.isNotEmpty &&
        !RegExp(r'^\d+$').hasMatch(tradeLicenseNumber)) {
      message = 'Trade License Number must contain numbers only.';
    }

    final tinNumber = _data['tinNumber']?.toString().trim() ?? '';
    if (message == null &&
        tinNumber.isNotEmpty &&
        !_isValidTin(tinNumber)) {
      message = 'TIN Number must contain exactly 12 digits.';
    }

    final officeEmail = _data['officeEmail']?.toString().trim() ?? '';
    if (message == null &&
        officeEmail.isNotEmpty &&
        !_isValidEmail(officeEmail)) {
      message = 'Please enter a valid office email address.';
    }

    final presentEmail =
        _data['presentEmail']?.toString().trim() ?? '';
    if (message == null &&
        presentEmail.isNotEmpty &&
        !_isValidEmail(presentEmail)) {
      message = 'Please enter a valid present address email address.';
    }

    final officeMobile = _data['officeMobile']?.toString().trim() ?? '';
    if (message == null &&
        officeMobile.isNotEmpty &&
        !_isValidMobile(officeMobile)) {
      message = 'Office mobile number must be 11 digits and start with 0.';
    }

    final presentMobile =
        _data['presentMobile']?.toString().trim() ?? '';
    if (message == null &&
        presentMobile.isNotEmpty &&
        !_isValidMobile(presentMobile)) {
      message = 'Present mobile number must be 11 digits and start with 0.';
    }

    final permanentMobile =
        _data['permanentMobile']?.toString().trim() ?? '';
    if (message == null &&
        permanentMobile.isNotEmpty &&
        !_isValidMobile(permanentMobile)) {
      message =
          'Permanent mobile number must be 11 digits and start with 0.';
    }

    final accountTitleBangla =
        _data['accountTitleBangla']?.toString() ?? '';
    if (message == null &&
        accountTitleBangla.isNotEmpty &&
        !_isBanglaOnly(accountTitleBangla)) {
      message =
          'Title of Account (in Bangla) must contain Bangla characters only.';
    }

    final nidNumber = _data['nidNumber']?.toString().trim() ?? '';
    if (message == null &&
        nidNumber.isNotEmpty &&
        !_isValidNid(nidNumber)) {
      message = 'NID Number must be exactly 10, 13, or 17 digits.';
    }

    final personTinNumber =
        _data['personTinNumber']?.toString().trim() ?? '';
    if (message == null &&
        personTinNumber.isNotEmpty &&
        !_isValidTin(personTinNumber)) {
      message =
          'Operating person TIN Number must contain exactly 12 digits.';
    }

    final monthlyIncome =
        _data['monthlyIncome']?.toString().trim() ?? '';
    if (message == null &&
        monthlyIncome.isNotEmpty &&
        !RegExp(r'^\d+$').hasMatch(monthlyIncome)) {
      message = 'Monthly Income must contain numbers only.';
    }

    final dobText = _data['dateOfBirth']?.toString().trim() ?? '';
    final dob = _parseDate(dobText);

    if (message == null && dobText.isNotEmpty && dob == null) {
      message = 'Date of Birth must be in DD-MM-YYYY format.';
    }

    if (message == null && dob != null) {
      final today = DateTime.now();
      final eighteenthBirthday = DateTime(
        today.year - 18,
        today.month,
        today.day,
      );

      if (dob.isAfter(DateTime.now())) {
        message = 'Date of Birth cannot be a future date.';
      } else if (dob.isAfter(eighteenthBirthday)) {
        message = 'The account operating person must be at least 18 years old.';
      }
    }

    if (message != null) {
      _show(message);
      return false;
    }

    return true;
  }

  Future<void> _pickDocument(String type) async {
    try {
      final files = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const [
          'pdf',
          'jpg',
          'jpeg',
          'png',
        ],
      );

      if (files.isEmpty || !mounted) return;

      final file = files.first;
      final bytes = await file.readAsBytes();

      if (bytes.length > 5 * 1024 * 1024) {
        _show('File must be 5 MB or smaller.');
        return;
      }

      final extension = file.extension?.toLowerCase();

      if (!['pdf', 'jpg', 'jpeg', 'png'].contains(extension)) {
        _show('Only PDF, JPG, JPEG and PNG files are allowed.');
        return;
      }
      
      setState(() {
        _data['documentName_$type'] = file.name;
        _data['documentBytes_$type'] = bytes;
      });
    } catch (error) {
      _show('Unable to select the document: $error');
    }
  }

  Future<void> _next() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    if (!_validateCustomFields()) {
      return;
    }

    if (_step < _steps.length - 1) {
      setState(() => _step++);
      return;
    }

    if (!_declarationAccepted) {
      _show('Please accept the declaration before submitting.');
      return;
    }

    final missing = _documents
        .where(
          (document) =>
              document.required &&
              _data['documentName_${document.type}'] == null,
        )
        .map((document) => document.type)
        .toList();

    if (missing.isNotEmpty) {
      _show('Please upload all required documents.');
      return;
    }

    await _submit();
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);

    try {
      final payload = Map<String, dynamic>.from(_data)
        ..removeWhere(
          (key, _) => key.startsWith('documentBytes_'),
        );

      final created = await _api.createApplication(payload);

      _applicationId = created['id'] as String;

      for (final document in _documents) {
        final bytes = _data['documentBytes_${document.type}'];
        final name = _data['documentName_${document.type}'];

        if (bytes is Uint8List && name is String) {
          await _api.uploadDocument(
            applicationId: _applicationId!,
            documentType: document.type,
            filename: name,
            bytes: bytes,
          );
        }
      }

      final submitted =
          await _api.submitApplication(_applicationId!);

      if (!mounted) return;

      setState(() {
        _submitted = true;
        _submittedApplicationNumber =
            submitted['application_number']?.toString();
        _submittedStatus =
            submitted['status']?.toString() ?? 'SUBMITTED';
      });
    } catch (error) {
      _show(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  void _show(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_submitted) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Investor Bank Account Opening'),
        ),
        body: SafeArea(
          child: _submittedApplicationView(),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Investor Bank Account Opening',
        ),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              _Header(
                step: _step,
                steps: _steps,
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    16,
                    14,
                    16,
                    112,
                  ),
                  children: [
                    _Intro(step: _step),
                    const SizedBox(height: 12),
                    _stepBody(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _BottomBar(
        step: _step,
        total: _steps.length,
        loading: _submitting,
        onPrevious: _step == 0
            ? null
            : () => setState(() => _step--),
        onNext: _next,
      ),
    );
  }

  Widget _stepBody() {
    switch (_step) {
      case 0:
        return _generalAndCompany();
      case 1:
        return _tradeTaxOffice();
      case 2:
        return _accountInfo();
      case 3:
        return _operatingPerson();
      default:
        return _documentsAndReview();
    }
  }

  Widget _generalAndCompany() {
    return Column(
      children: [
        SectionCard(
          sectionNumber: 1,
          title: 'General Information',
          description:
              'Provide the bank and branch details where the investor account will be opened.',
          children: [
            _field(
              'bankName',
              'Name of Bank',
              required: true,
            ),
            const SizedBox(height: 12),
            _branchDropdown(),
            const SizedBox(height: 12),
            _responsiveRow([
              _field('branchCode', 'Branch Code'),
              _countryDropdown(),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _field(
                'branchDistrict',
                'Name of District',
                required: true,
              ),
              _field(
                'branchThana',
                'Thana / Upazila',
                required: true,
              ),
            ]),
          ],
        ),
        const SizedBox(height: 12),
        SectionCard(
          sectionNumber: 2,
          title: 'Company Registration Information',
          children: [
            _responsiveRow([
              _field(
                'incorporationNumber',
                'Incorporation Number',
                required: true,
              ),
              _dateField(
                'incorporationDate',
                'Incorporation Date',
                required: true,
              ),
            ]),
            const SizedBox(height: 12),
            _field(
              'registrationAuthority',
              'Registration Authority',
              required: true,
            ),
            const SizedBox(height: 12),
            _field(
              'registeredAddress',
              'Registered Address',
              required: true,
              maxLines: 3,
            ),
          ],
        ),
      ],
    );
  }

  Widget _tradeTaxOffice() {
    return Column(
      children: [
        SectionCard(
          sectionNumber: 3,
          title: 'Trade License Information',
          children: [
            _responsiveRow([
              _field(
                'tradeLicenseNumber',
                'Trade License Number',
                required: true,
                keyboardType: TextInputType.number,
              ),
              _dateField(
                'tradeLicenseDate',
                'Date of Trade License',
                required: true,
              ),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _dateField(
                'tradeLicenseExpiry',
                'Expired Date',
                required: true,
              ),
              _field(
                'tradeLicenseAuthority',
                'Issuing Authority',
              ),
            ]),
          ],
        ),
        const SizedBox(height: 12),
        SectionCard(
          sectionNumber: 4,
          title: 'Taxpayer Identification',
          children: [
            _field(
              'tinNumber',
              'TIN Number',
              required: true,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 5),
            Text(
              'Taxpayer Identification Number issued by NBR',
              style: TextStyle(
                color: Colors.grey.shade700,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        SectionCard(
          sectionNumber: 5,
          title: 'Office Address',
          children: [
            _responsiveRow([
              _field(
                'officeDistrict',
                'District',
                required: true,
              ),
              _field(
                'officeThana',
                'Thana / Upazila',
                required: true,
              ),
            ]),
            const SizedBox(height: 12),
            _field(
              'officeAddress',
              'Address',
              required: true,
              maxLines: 3,
            ),
            const SizedBox(height: 12),
            _responsiveRow([
              _field(
                'officeEmail',
                'Email Address',
                required: true,
                keyboardType: TextInputType.emailAddress,
              ),
              _field(
                'officeMobile',
                'Mobile Number',
                required: true,
                keyboardType: TextInputType.phone,
              ),
            ]),
          ],
        ),
      ],
    );
  }

  Widget _accountInfo() {
    return SectionCard(
      sectionNumber: 6,
      title: 'Account Information',
      description:
          'Provide details about the bank account to be opened. Ensure the account title matches the registered company name exactly.',
      children: [
        _responsiveRow([
          _field(
            'accountTitleBangla',
            'Title of Account (in Bangla)',
            required: true,
          ),
          _field(
            'accountTitleEnglish',
            'Title of Account (in English)',
            required: true,
          ),
        ]),
        const SizedBox(height: 12),
        _responsiveRow([
          _dropdown(
            'accountNature',
            'Nature of Account',
            const [
              'Current Account',
              'Savings Account',
              'Other',
            ],
            required: true,
          ),
          _dropdown(
            'businessSector',
            'Business Sector',
            const [
              'Construction',
              'Manufacturing',
              'Trading',
              'Services',
              'Other',
            ],
            required: true,
          ),
        ]),
        const SizedBox(height: 12),
        _responsiveRow([
          _field(
            'subCategory',
            'Sub Category',
            required: true,
          ),
          _dropdown(
            'currency',
            'Currency',
            const [
              'BDT - Bangladeshi Taka',
              'USD - US Dollar',
              'EUR - Euro',
            ],
            required: true,
          ),
        ]),
        const SizedBox(height: 12),
        _responsiveRow([
          _dropdown(
            'entityType',
            'Entity Type',
            const [
              'Company',
              'Partnership',
              'Other',
            ],
            required: true,
          ),
          _dropdown(
            'accountType',
            'Account Type',
            const [
              'Corporate Account',
              'Investment Account',
            ],
            required: true,
          ),
        ]),
      ],
    );
  }

  Widget _operatingPerson() {
    return Column(
      children: [
        SectionCard(
          title: 'Account Operating Person Information',
          description:
              'Provide details of the authorised person who will operate this account. This person must be a designated signatory of the company.',
          children: [
            _responsiveRow([
              _field(
                'personFullName',
                'Full Name',
                required: true,
              ),
              _field(
                'fatherName',
                "Father's Name",
                required: true,
              ),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _field(
                'motherName',
                "Mother's Name",
                required: true,
              ),
              _field(
                'spouseName',
                'Spouse Name',
              ),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _field(
                'nidNumber',
                'NID Number',
                required: true,
                keyboardType: TextInputType.number,
              ),
              _dateField(
                'dateOfBirth',
                'Date of Birth',
                required: true,
              ),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _field(
                'nationality',
                'Nationality',
                required: true,
              ),
              _dropdown(
                'gender',
                'Gender',
                const [
                  'Female',
                  'Male',
                  'Other',
                ],
                required: true,
              ),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _dropdown(
                'relationWithOrganization',
                'Relation with Organization',
                const [
                  'Director',
                  'Shareholder',
                  'Authorised Representative',
                  'Other',
                ],
                required: true,
              ),
              _field(
                'personTinNumber',
                'TIN Number',
                keyboardType: TextInputType.number,
              ),
            ]),
            const SizedBox(height: 12),
            _responsiveRow([
              _field(
                'occupation',
                'Occupation',
                required: true,
              ),
              _field(
                'monthlyIncome',
                'Monthly Income',
                required: true,
                keyboardType: TextInputType.number,
              ),
            ]),
            const SizedBox(height: 12),
            _field(
              'sourceOfFund',
              'Source of Fund',
              required: true,
            ),
          ],
        ),
        const SizedBox(height: 12),
        _addressSection(
          'Present Address (Operating Person)',
          'present',
          requiredEmail: true,
        ),
        const SizedBox(height: 12),
        SectionCard(
          title: 'Permanent Address (Operating Person)',
          children: [
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _sameAddress,
              title: const Text(
                'Same as Present Address',
              ),
              onChanged: (value) {
                setState(() {
                  _sameAddress = value ?? false;

                  if (_sameAddress) {
                    for (final field in const [
                      'District',
                      'Thana',
                      'Address',
                      'Email',
                      'Mobile',
                    ]) {
                      _data['permanent$field'] =
                          _data['present$field'];
                    }
                  }
                });
              },
            ),
            if (!_sameAddress)
              _addressFields(
                'permanent',
                requiredEmail: false,
              )
            else
              const Text(
                'Permanent address will use the present address.',
              ),
          ],
        ),
      ],
    );
  }

  Widget _addressSection(
    String title,
    String prefix, {
    required bool requiredEmail,
  }) {
    return SectionCard(
      title: title,
      children: [
        _addressFields(
          prefix,
          requiredEmail: requiredEmail,
        ),
      ],
    );
  }

  Widget _addressFields(
    String prefix, {
    required bool requiredEmail,
  }) {
    return Column(
      children: [
        _responsiveRow([
          _field(
            '${prefix}District',
            'District',
            required: true,
          ),
          _field(
            '${prefix}Thana',
            'Thana / Upazila',
            required: true,
          ),
        ]),
        const SizedBox(height: 12),
        _field(
          '${prefix}Address',
          'Address',
          required: true,
          maxLines: 3,
        ),
        const SizedBox(height: 12),
        _responsiveRow([
          _field(
            '${prefix}Email',
            'Email Address',
            required: requiredEmail,
            keyboardType: TextInputType.emailAddress,
          ),
          _field(
            '${prefix}Mobile',
            'Mobile Number',
            required: true,
            keyboardType: TextInputType.phone,
          ),
        ]),
      ],
    );
  }

  Widget _documentsAndReview() {
    return Column(
      children: [
        SectionCard(
          title: 'Required Documents & Attachments',
          description:
              'Upload clear, legible scanned copies or photographs. Accepted formats: PDF, JPG, PNG. Maximum 5 MB each. Documents marked * are mandatory.',
          children: [
            for (final document in _documents)
              _documentTile(document),
          ],
        ),
        const SizedBox(height: 12),
        SectionCard(
          title: 'Declaration',
          children: [
            const Text(
              'I/We hereby declare that the information furnished above is true and correct to the best of my/our knowledge and belief. I/We understand that any false information may result in rejection of this application and/or legal action.\n\n'
              'I/We agree to abide by the rules and regulations of Bangladesh Investment Development Authority (BIDA) and the concerned bank.',
              style: TextStyle(height: 1.5),
            ),
            const SizedBox(height: 10),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _declarationAccepted,
              title: const Text(
                'I/We confirm that I/We have read, understood, and agree to the declaration above. *',
              ),
              onChanged: (value) {
                setState(
                  () => _declarationAccepted = value ?? false,
                );
              },
            ),
          ],
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _submittedApplicationView() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
      children: [
        SectionCard(
          title: 'Application Submitted',
          description:
              'Your investor bank account opening application has been submitted successfully.',
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFF2F8F4),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: const Color(0xFFD6E9DC),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Application Number',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _submittedApplicationNumber ?? 'Not available',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Status',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _submittedStatus,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        SectionCard(
          title: 'Review & Confirm Your Application',
          description:
              'This is your submitted application information. Keep your application number for future reference.',
          children: [
            for (final entry in _reviewEntries())
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text(
                  entry.$1,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle: Text(entry.$2),
              ),
          ],
        ),
      ],
    );
  }

  List<(String, String)> _reviewEntries() {
    const keys = [
      ('Bank', 'bankName'),
      ('Branch', 'branchName'),
      ('Incorporation Number', 'incorporationNumber'),
      ('Registration Authority', 'registrationAuthority'),
      ('TIN Number', 'tinNumber'),
      ('Office Email', 'officeEmail'),
      ('Account Title', 'accountTitleEnglish'),
      ('Account Nature', 'accountNature'),
      ('Business Sector', 'businessSector'),
      ('Currency', 'currency'),
      ('Entity Type', 'entityType'),
      ('Account Type', 'accountType'),
      ('Operating Person', 'personFullName'),
      ('NID Number', 'nidNumber'),
      ('Occupation', 'occupation'),
      ('Monthly Income', 'monthlyIncome'),
      ('Source of Fund', 'sourceOfFund'),
    ];

    return [
      for (final item in keys)
        (
          item.$1,
          (_data[item.$2] ?? 'Not provided').toString(),
        ),
    ];
  }

  Widget _documentTile(
    _DocumentRequirement document,
  ) {
    final name =
        _data['documentName_${document.type}'] as String?;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FBFA),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: const Color(0xFFE0E8E4),
        ),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: name == null
              ? Theme.of(context)
                  .colorScheme
                  .primaryContainer
              : Colors.green.shade100,
          child: Icon(
            name == null
                ? Icons.upload_file_outlined
                : Icons.check_rounded,
          ),
        ),
        title: Text(
          '${document.type}${document.required ? ' *' : ''}',
          style: const TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Text(
          name ??
              (document.required
                  ? 'Required'
                  : 'Optional'),
        ),
        trailing: OutlinedButton.icon(
          icon: const Icon(
            Icons.upload_outlined,
          ),
          label: const Text('Upload'),
          onPressed: () =>
              _pickDocument(document.type),
        ),
      ),
    );
  }

  Widget _field(
    String key,
    String label, {
    bool required = false,
    String? initial,
    TextInputType? keyboardType,
    int maxLines = 1,
  }) {
    final value = _data[key]?.toString();

    return ExpandedIfNeeded(
      child: AppField(
        label: label,
        required: required,
        initialValue: value ?? initial,
        keyboardType: keyboardType,
        maxLines: maxLines,
        onChanged: (text) {
          var nextValue = text;

          if (const {
            'tradeLicenseNumber',
            'tinNumber',
            'nidNumber',
            'personTinNumber',
            'monthlyIncome',
            'officeMobile',
            'presentMobile',
            'permanentMobile',
          }.contains(key)) {
            nextValue = _digitsOnly(text);
          }

          setState(() => _set(key, nextValue));
        },
      ),
    );
  }

  Widget _dateField(
    String key,
    String label, {
    bool required = false,
  }) {
return ExpandedIfNeeded(
    child: AppField(
      label: label,
      required: required,
      initialValue: _data[key]?.toString() ?? '',
      readOnly: true,
      onTap: () => _pickDate(key),
      onChanged: (_) {},
      ),
    );
  }

  static const List<String> _countries = <String>[
    'Afghanistan',
    'Albania',
    'Algeria',
    'Andorra',
    'Angola',
    'Antigua and Barbuda',
    'Argentina',
    'Armenia',
    'Australia',
    'Austria',
    'Azerbaijan',
    'Bahamas',
    'Bahrain',
    'Bangladesh',
    'Barbados',
    'Belarus',
    'Belgium',
    'Belize',
    'Benin',
    'Bhutan',
    'Bolivia',
    'Bosnia and Herzegovina',
    'Botswana',
    'Brazil',
    'Brunei',
    'Bulgaria',
    'Burkina Faso',
    'Burundi',
    'Cabo Verde',
    'Cambodia',
    'Cameroon',
    'Canada',
    'Central African Republic',
    'Chad',
    'Chile',
    'China',
    'Colombia',
    'Comoros',
    'Congo, Democratic Republic of the',
    'Congo, Republic of the',
    'Costa Rica',
    "Côte d'Ivoire",
    'Croatia',
    'Cuba',
    'Cyprus',
    'Czechia',
    'Denmark',
    'Djibouti',
    'Dominica',
    'Dominican Republic',
    'Ecuador',
    'Egypt',
    'El Salvador',
    'Equatorial Guinea',
    'Eritrea',
    'Estonia',
    'Eswatini',
    'Ethiopia',
    'Fiji',
    'Finland',
    'France',
    'Gabon',
    'Gambia',
    'Georgia',
    'Germany',
    'Ghana',
    'Greece',
    'Grenada',
    'Guatemala',
    'Guinea',
    'Guinea-Bissau',
    'Guyana',
    'Haiti',
    'Honduras',
    'Hungary',
    'Iceland',
    'India',
    'Indonesia',
    'Iran',
    'Iraq',
    'Ireland',
    'Israel',
    'Italy',
    'Jamaica',
    'Japan',
    'Jordan',
    'Kazakhstan',
    'Kenya',
    'Kiribati',
    'Kuwait',
    'Kyrgyzstan',
    'Laos',
    'Latvia',
    'Lebanon',
    'Lesotho',
    'Liberia',
    'Libya',
    'Liechtenstein',
    'Lithuania',
    'Luxembourg',
    'Madagascar',
    'Malawi',
    'Malaysia',
    'Maldives',
    'Mali',
    'Malta',
    'Marshall Islands',
    'Mauritania',
    'Mauritius',
    'Mexico',
    'Micronesia',
    'Moldova',
    'Monaco',
    'Mongolia',
    'Montenegro',
    'Morocco',
    'Mozambique',
    'Myanmar',
    'Namibia',
    'Nauru',
    'Nepal',
    'Netherlands',
    'New Zealand',
    'Nicaragua',
    'Niger',
    'Nigeria',
    'North Korea',
    'North Macedonia',
    'Norway',
    'Oman',
    'Pakistan',
    'Palau',
    'Palestine',
    'Panama',
    'Papua New Guinea',
    'Paraguay',
    'Peru',
    'Philippines',
    'Poland',
    'Portugal',
    'Qatar',
    'Romania',
    'Russia',
    'Rwanda',
    'Saint Kitts and Nevis',
    'Saint Lucia',
    'Saint Vincent and the Grenadines',
    'Samoa',
    'San Marino',
    'Sao Tome and Principe',
    'Saudi Arabia',
    'Senegal',
    'Serbia',
    'Seychelles',
    'Sierra Leone',
    'Singapore',
    'Slovakia',
    'Slovenia',
    'Solomon Islands',
    'Somalia',
    'South Africa',
    'South Korea',
    'South Sudan',
    'Spain',
    'Sri Lanka',
    'Sudan',
    'Suriname',
    'Sweden',
    'Switzerland',
    'Syria',
    'Tajikistan',
    'Tanzania',
    'Thailand',
    'Timor-Leste',
    'Togo',
    'Tonga',
    'Trinidad and Tobago',
    'Tunisia',
    'Türkiye',
    'Turkmenistan',
    'Tuvalu',
    'Uganda',
    'Ukraine',
    'United Arab Emirates',
    'United Kingdom',
    'United States',
    'Uruguay',
    'Uzbekistan',
    'Vanuatu',
    'Vatican City',
    'Venezuela',
    'Vietnam',
    'Yemen',
    'Zambia',
    'Zimbabwe',
  ];

  Widget _branchDropdown() {
    final stored = _data['branchName']?.toString();
    final selected =
        _branchNames.contains(stored) ? stored : null;

    return ExpandedIfNeeded(
      child: DropdownButtonFormField<String>(
        initialValue: selected,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Branch Name *',
        ),
        hint: Text(
          _loadingBranches
              ? 'Loading AIBL branches...'
              : 'Select a branch',
        ),
        items: [
          for (final branch in _branchNames)
            DropdownMenuItem<String>(
              value: branch,
              child: Text(branch),
            ),
        ],
        validator: (value) {
          if (value == null || value.isEmpty) {
            return 'Required';
          }
          return null;
        },
        onChanged: (value) {
          if (value == null) return;

          setState(() => _set('branchName', value));
        },
      ),
    );
  }

  Widget _countryDropdown() {
    final stored = _data['country']?.toString();
    final selected =
        _countries.contains(stored) ? stored : null;

    return ExpandedIfNeeded(
      child: DropdownButtonFormField<String>(
        initialValue: selected,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Country *',
        ),
        hint: const Text('Select a country'),
        items: [
          for (final country in _countries)
            DropdownMenuItem<String>(
              value: country,
              child: Text(country),
            ),
        ],
        validator: (value) {
          if (value == null || value.isEmpty) {
            return 'Required';
          }
          return null;
        },
        onChanged: (value) {
          if (value == null) return;

          setState(() => _set('country', value));
        },
      ),
    );
  }

  Widget _dropdown(
    String key,
    String label,
    List<String> options, {
    bool required = false,
  }) {
    final stored = _data[key]?.toString();
    final selected =
        options.contains(stored) ? stored : null;

    return ExpandedIfNeeded(
      child: DropdownButtonFormField<String>(
    initialValue: selected,
        decoration: InputDecoration(
          labelText:
              required ? '$label *' : label,
        ),
        items: [
          for (final option in options)
            DropdownMenuItem(
              value: option,
              child: Text(option),
            ),
        ],
        validator: required
            ? (value) {
                if (value == null ||
                    value.isEmpty) {
                  return 'Required';
                }
                return null;
              }
            : null,
        onChanged: (value) {
          if (value == null) return;

          setState(
            () => _set(key, value),
          );
        },
      ),
    );
  }

  Widget _responsiveRow(
    List<Widget> children,
  ) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 680) {
          return Column(
            children: [
              for (int i = 0;
                  i < children.length;
                  i++) ...[
                children[i],
                if (i != children.length - 1)
                  const SizedBox(height: 12),
              ],
            ],
          );
        }

        return Row(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            for (int i = 0;
                i < children.length;
                i++) ...[
              Expanded(child: children[i]),
              if (i != children.length - 1)
                const SizedBox(width: 12),
            ],
          ],
        );
      },
    );
  }
}



class ExpandedIfNeeded extends StatelessWidget {
  const ExpandedIfNeeded({
    super.key,
    required this.child,
  });

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return child;
  }
}

class _DocumentRequirement {
  const _DocumentRequirement(
    this.type,
    this.required,
  );

  final String type;
  final bool required;
}

class _Intro extends StatelessWidget {
  const _Intro({
    required this.step,
  });

  final int step;

  @override
  Widget build(BuildContext context) {
    const descriptions = [
      'Local Investor Form · Corporate Account',
      'Business registration, tax and office details',
      'Bank account details for the investment entity',
      'Authorised account operating person details',
      'Documents, declaration and final confirmation',
    ];

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context)
                .colorScheme
                .primaryContainer,
            Colors.white,
          ],
        ),
        borderRadius:
            BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFDDE8E2),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.account_balance_rounded,
            size: 30,
            color: Theme.of(context)
                .colorScheme
                .primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                const Text(
                  'Open an Investor Bank Account',
                  style: TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  descriptions[step],
                  style: TextStyle(
                    color: Colors.grey.shade700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.step,
    required this.steps,
  });

  final int step;
  final List<String> steps;

  @override
  Widget build(BuildContext context) {
    final colorScheme =
        Theme.of(context).colorScheme;

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(
        16,
        10,
        16,
        12,
      ),
      child: Column(
        children: [
          LinearProgressIndicator(
            value: (step + 1) / steps.length,
          ),
          const SizedBox(height: 10),
          SingleChildScrollView(
            scrollDirection:
                Axis.horizontal,
            child: Row(
              children: [
                for (int i = 0;
                    i < steps.length;
                    i++) ...[
                  Chip(
                    label: Text(
                      '${i + 1}. ${steps[i]}',
                    ),
                    backgroundColor:
                        i == step
                            ? colorScheme
                                .primaryContainer
                            : null,
                  ),
                  if (i != steps.length - 1)
                    const SizedBox(width: 6),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  const _BottomBar({
    required this.step,
    required this.total,
    required this.loading,
    required this.onPrevious,
    required this.onNext,
  });

  final int step;
  final int total;
  final bool loading;
  final VoidCallback? onPrevious;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 12,
      color: Colors.white,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            16,
            10,
            16,
            12,
          ),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onPrevious,
                  child: const Text('Previous'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed:
                      loading ? null : onNext,
                  child: loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child:
                              CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : Text(
                          step == total - 1
                              ? 'Submit Application'
                              : 'Next',
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

