import {
  Component,
  ChangeDetectorRef,
  AfterViewInit,
  ViewChild,
  ElementRef
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LoginService } from '../../services/login.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { interval, Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { secommendcenter } from '../../services/secommedcenter.service';
import { SemarketplaceService } from '../../services/semarketplace.service';

declare var $: any;

@Component({
  selector: 'app-testcase',
  imports: [CommonModule, FormsModule],
  templateUrl: './testcase.html',
  styleUrl: './testcase.css',
})
export class Testcase implements AfterViewInit {
  @ViewChild('loadalert') loadalert?: ElementRef;
  @ViewChild('scrollContainer') scrollContainer!: ElementRef;

  loggedUser: any;
  userName: any;
  employeeId: any;
  userRole: any;
  roleId: any;
  roleDetail: string = '';
  emailID: any;
  totalItemsUM: number = 0;
  totalRecordsUM: number = 0;
  TestCaseGridData: any[] = [];
  UserManagementGridData: any[] = [];
  testCaseResponse: string = '';
  selectedTestCases: string = '';
  sanitizedHtml: SafeHtml = '';
  selectedEventOutput: any[] = [];
  selectedEventId: string = '';
  isDisabled: boolean = false;
  private pollingSubscription: Subscription | null = null;
  isLoading = false;
  lastFetchedTs: number = 0;
  showTestCases: boolean = false;
  agentSteps: any[] = [];
  agencyId = '';
  eventTrackingUniqueId: string = '';
  systemPrompt: string = '';
  thoughts: any[] = [];
  actions: string = '';
  refrainPrompt: string = '';
  thoughtsInput: string = '';
  selectAllChecked: boolean = false;
  showModal: boolean = false;
  Usermessage: string = '';
  popupTitle: string = '';
  message = '';
  IsReviewCases: boolean = false;
  selectedInfoItem: any = null;
  IsInfoPanelOpen: boolean = false;
  TestStatusLoader: any[] = [];

  stepMessages = [
    {
      label: 'Initializing test case generation...',
      key: 'Initializing',
      imgurl: 'assets/img/initialize-Icon.png',
      active: false,
    },
    {
      label: 'Extracting use cases',
      key: 'Extracting',
      imgurl: 'assets/img/extract-icon.png',
      active: false,
    },
    {
      label: 'Analyzing functional flows and scenarios...',
      key: 'Analyzing',
      imgurl: 'assets/img/analyzing-Icon.png',
      active: false,
    },
    {
      label: 'Identifying edge cases and validation points...',
      key: 'Validation',
      imgurl: 'assets/img/identifying-Icon.png',
      active: false,
    },
    {
      label: 'Mapping use cases to structured test cases...',
      key: 'Mapping',
      imgurl: 'assets/img/mapping-Icon.png',
      active: false,
    },
    {
      label: 'Generating test case titles and steps',
      key: 'Generating',
      imgurl: 'assets/img/generate-icon.png',
      active: false,
    },
    {
      label: 'Finalizing and loading generated test cases.',
      key: 'Finalizing',
      imgurl: 'assets/img/finalize-icon.png',
      active: false,
    },
  ];

  visibleSteps: {
    label: string;
    key: string;
    imgurl: string;
    active: boolean;
  }[] = [];

  constructor(
    private _loadingService: NgxSpinnerService,
    private _router: Router,
    private _stateService: AIInfuseStateService,
    private _commentService: secommendcenter,
    private _marketService: SemarketplaceService,
    private _loginservice: LoginService,
    private changeDetectorRef: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  ngAfterViewInit(): void {
    const toggleBtn = document.querySelector('.toggleBtn');
    const sidebar = document.querySelector('.sidebar');

    // Initial collapse based on flag
    if (this.IsReviewCases) {
      sidebar?.classList.add('expanded');
    } else {
      sidebar?.classList.remove('expanded');
    }

    // Allow user to toggle manually
    toggleBtn?.addEventListener('click', () => {
      sidebar?.classList.toggle('expanded');
    });
  }

  ngAfterViewChecked() {
    this.scrollToBottom(); // ensures DOM is updated
  }

  ngOnInit(): void {
    // Stop the spinner when the component is initialized

    this.loggedUser = this._stateService.getLoginDetails();
    this.userName = this.loggedUser.UserName;
    this.emailID = this.loggedUser.Email;
    this.employeeId = this.loggedUser.EmployeeId;
    this.roleDetail = this.loggedUser.Role;
    //this.gettestCases();
    this.IsReviewCases = this._stateService.getIsReviewCase();
    this.agencyId = this._stateService.getSelectedAgency();

    if (this.IsReviewCases) {
      this.gettestevent(this.agencyId);
      this.isDisabled = true;
      this.onBindAIExplanation();
    }
    this.loadAgentSteps(this.agencyId);
    this._loadingService.hide();
    //this.showStepsDynamically();
  }

  isActiveRoute(route: string): boolean {
    // Check if the current route matches the provided route
    return this._router.url === route;
  }

  home_link(): void {
    // Navigate to the home page
    this._router.navigate(['/home']);
  }

  toggleSection(val: boolean) {
    this.showTestCases = val;
  }

  isLastToolSet(tools: string[]): boolean {
    const allowedTools = ['doc', 'jira', 'excel', 'sharepoint'];
    return tools?.some((tool) => allowedTools.includes(tool));
  }

  testCaseGenerate(): void {
    //this._loadingService.show();
    this.TestCaseGridData = [];
    this.selectedEventOutput = [];
    this.changeDetectorRef.detectChanges();
    this.isDisabled = true;
    this.onFlagChange(true);
    this.showLoader();
    this.onBindAIExplanation();
    this.lastFetchedTs = new Date().getTime(); // UTC timestamp in milliseconds
    this.showStepsDynamically();
    this.eventTrackingUniqueId = crypto.randomUUID();
    var params = {
      UserMail: this.emailID,
      EventTrackingUniqueId: this.eventTrackingUniqueId,
      AgencyId: this.agencyId,
    };

    this._commentService.testCaseGenerate(params).subscribe((data) => {
      if (data != null || data != undefined) {
        //this._loadingService.hide();

        //this.TestCaseGridData = data;
        this.isDisabled = false;
        this.onFlagChange(false);

        // if (this.TestCaseGridData != null || this.TestCaseGridData != undefined) {
        //   this.onParentRowClick(data.data);
        // }
        this.hideLoader();
        this.gettestCases();

        const toggleBtn = document.querySelector('.toggleBtn');
        const sidebar = document.querySelector('.sidebar');

        // Initial collapse based on flag
        sidebar?.classList.add('expanded');
        // Allow user to toggle manually
        this.changeDetectorRef.detectChanges();
      } else {
        this._loadingService.hide();
      }
    });
  }

  gettestCases(): void {
    this.lastFetchedTs = new Date().getTime(); // UTC timestamp in milliseconds

    var params = {
      EventTrackingUniqueId: this.eventTrackingUniqueId,
      UserMail: this.emailID,
    };
    //this._loadingService.show();
    this._commentService.gettestCases(params).subscribe((data) => {
      if (data != null || data != undefined) {
        //this._loadingService.hide();

        this.TestCaseGridData = data.data;
        this.TestStatusLoader = data.statusLoader;

        const status = this.TestStatusLoader[0]?.status;

        this.stepMessages = this.stepMessages.map((step) => ({
          ...step,
          active: !!status[step.key], // ensures boolean true/false
        }));

        this.visibleSteps = this.stepMessages.filter((step) => step.active);

        this.scrollToBottom();

        this.changeDetectorRef.detectChanges();

        if (
          this.TestCaseGridData != null ||
          this.TestCaseGridData != undefined
        ) {
          this.onParentRowClick(data.data[0]);
        }

        this.changeDetectorRef.detectChanges();
      } else {
        this._loadingService.hide();
      }
    });
  }

  gettestevent(agencyId: string): void {
    this.lastFetchedTs = new Date().getTime(); // UTC timestamp in milliseconds
    var params = {
      UserMail: this.emailID,
      agencyId: agencyId,
    };

    this._loadingService.show();
    this._commentService.gettestevents(params).subscribe((data) => {
      if (data != null || data != undefined) {
        //this._loadingService.hide();

        this.TestCaseGridData = data.data;
        this.changeDetectorRef.detectChanges();

        if (
          this.TestCaseGridData != null ||
          this.TestCaseGridData != undefined
        ) {
          this.onParentRowClick(data.data[0]);
        }

        this.changeDetectorRef.detectChanges();
      } else {
        this._loadingService.hide();
      }
    });
  }

  onBindAIExplanation(): void {
    this.systemPrompt =
      'Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.\nThe top-level keys should include:\n- test_case_title\n- user_story\n- acceptance_criteria (as a list)\n- test_cases (as a list of objects)\n- summary\n\nInside each item in test_cases, include:\n- test_case_name\n- objective\n- preconditions (as a list)\n- test_steps (as a list)\n- expected_results (as a list, one for each test step)\n\nDo not include markdown, code blocks, or explanations — only return a pure JSON object.';
    this.thoughts = [
      { role: 'system', content: 'SYSTEM_MESSAGE' },
      {
        role: 'user',
        content:
          '\n        You are an AI assistant tasked with improving a previous response based on provided feedback. Your goal is to carefully analyze the feedback and create an enhanced version of the original output that addresses all points of criticism or suggestions for improvement.\n\n        Here is the previous input:\n        <old_input>\n        Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.\n\n        The top-level keys should include:\n        - test_case_title\n        - user_story\n        - acceptance_criteria (as a list)\n        - test_cases (as a list of objects)\n        - summary\n\n        Inside each item in test_cases, include:\n        - test_case_name\n        - objective\n        - preconditions (as a list)\n        - test_steps (as a list)\n        - expected_results (as a list, one for each test step)\n\n        Do not include markdown, code blocks, or explanations \u2014 only return a pure JSON object.\n\n        As a user, I want to receive feedback for each action\nSo that I know if my information and documents are accepted or if I need to make corrections.\n\u2022 Acceptance Criteria:\n\u2022 System displays clear error messages for invalid inputs or missing fields.\n\u2022 System displays success messages for successful uploads and verifications.\n\n\n        </old_input>\n\n        Here is the previous output:\n        <old_output>\n        {\n  "test_case_title": "Receive Feedback for Actions",\n  "user_story": "As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.",\n  "acceptance_criteria": [\n    "System displays clear error messages for invalid inputs or missing fields.",\n    "System displays success messages for successful uploads and verifications."\n  ],\n  "test_cases": [\n    {\n      "test_case_name": "Invalid Input Feedback",\n      "objective": "To verify that the system displays clear error messages for invalid inputs.",\n      "preconditions": [\n        "User is logged in to the system."\n      ],\n      "test_steps": [\n        "Enter invalid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays clear error messages indicating which fields contain invalid inputs.",\n        "User is prompted to correct the errors."\n      ]\n    },\n    {\n      "test_case_name": "Success Upload Verification",\n      "objective": "To verify that the system displays success messages for successful uploads and verifications.",\n      "preconditions": [\n        "User is logged in to the system.",\n        "Valid data is entered in the required fields."\n      ],\n      "test_steps": [\n        "Enter valid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays a success message confirming the upload and verification.",\n        "User is notified that the information and documents have been accepted."\n      ]\n    }\n  ],\n  "summary": "This test case suite aims to verify that the system provides clear feedback to users regarding the status of their inputs and documents, whether they are accepted or need corrections."\n}\n        </old_output>\n\n        Here is the feedback provided:\n        <feedback>\n        Reflection_Result: "Pass"\n\nReflection_Result_Reason: "The output aligns with the instructions provided in the system prompt."\n\n**Explanation:**\n\n1. **Processing the User Story:**\n   - The user story provided was: "As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections."\n   - The acceptance criteria were also provided: \n     - System displays clear error messages for invalid inputs or missing fields.\n     - System displays success messages for successful uploads and verifications.\n\n2. **Creating Test Cases:**\n   - The output includes a well-structured test case title, user story, acceptance criteria, and detailed test cases.\n   - Each test case includes:\n     - `test_case_name`\n     - `objective`\n     - `preconditions` (as a list)\n     - `test_steps` (as a list)\n     - `expected_results` (as a list, one for each test step)\n\n3. **Structure and Clarity:**\n   - The test cases are clearly structured and follow the required format.\n   - The summary provides a concise overview of the test case suite.\n\n4. **Alignment with Instructions:**\n   - The output adheres to the instructions provided in the system prompt.\n   - The test cases cover the functionality described in the user story and align with the acceptance criteria.\n\nTherefore, the output meets the expectations and aligns with the instructions and the goal specified in the system prompt.\nBias Report: No opinions detected for bias analysis.\n        </feedback>\n\n        Here is the conversation history for context:\n        \nMessage History:\nuser: Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.\n\n        The top-level keys should include:\n        - test_case_title\n        - user_story\n        - acceptance_criteria (as a list)\n        - test_cases (as a list of objects)\n        - summary\n\n        Inside each item in test_cases, include:\n        - test_case_name\n        - objective\n        - preconditions (as a list)\n        - test_steps (as a list)\n        - expected_results (as a list, one for each test step)\n\n        Do not include markdown, code blocks, or explanations \u2014 only return a pure JSON object.\n\n        As a user, I want to receive feedback for each action\nSo that I know if my information and documents are accepted or if I need to make corrections.\n\u2022 Acceptance Criteria:\n\u2022 System displays clear error messages for invalid inputs or missing fields.\n\u2022 System displays success messages for successful uploads and verifications.\n\n\nassistant: {\n  "test_case_title": "Receive Feedback for Actions",\n  "user_story": "As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.",\n  "acceptance_criteria": [\n    "System displays clear error messages for invalid inputs or missing fields.",\n    "System displays success messages for successful uploads and verifications."\n  ],\n  "test_cases": [\n    {\n      "test_case_name": "Invalid Input Feedback",\n      "objective": "To verify that the system displays clear error messages for invalid inputs.",\n      "preconditions": [\n        "User is logged in to the system."\n      ],\n      "test_steps": [\n        "Enter invalid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays clear error messages indicating which fields contain invalid inputs.",\n        "User is prompted to correct the errors."\n      ]\n    },\n    {\n      "test_case_name": "Success Upload Verification",\n      "objective": "To verify that the system displays success messages for successful uploads and verifications.",\n      "preconditions": [\n        "User is logged in to the system.",\n        "Valid data is entered in the required fields."\n      ],\n      "test_steps": [\n        "Enter valid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays a success message confirming the upload and verification.",\n        "User is notified that the information and documents have been accepted."\n      ]\n    }\n  ],\n  "summary": "This test case suite aims to verify that the system provides clear feedback to users regarding the status of their inputs and documents, whether they are accepted or need corrections."\n}\n\n        Follow these steps to improve the response:\n\n        1. Carefully read and analyze the feedback provided. Pay attention to each point of criticism or suggestion for improvement.\n\n        2. For each point in the feedback:\n        a. Identify the specific issue or area for improvement.\n        b. Consider how to address this issue in your revised response.\n        c. Make note of any changes or additions you plan to make.\n\n        3. Review the previous input and output to ensure you understand the context and original intent of the response.\n\n        4. Begin crafting your improved response:\n        a. Start with the structure and content of the original output.\n        b. Incorporate the changes and improvements you identified in step 2.\n        c. Ensure that each point of feedback is thoroughly addressed.\n        d. Maintain coherence and flow in your revised response.\n\n        5. After incorporating all improvements, review your new response to ensure it:\n        a. Addresses all feedback points.\n        b. Maintains or enhances the quality of the original response.\n        c. Remains relevant to the original input.\n        d. Is clear, concise, and well-structured.\n\n        6. If necessary, make final adjustments to polish your response.\n\n        Provide your final, comprehensive response that addresses all feedback points within <improved_response> tags. Ensure that your improved response is a complete, standalone answer that can be understood without reference to the original output or feedback.\n\n        After your improved response, include a brief summary of the changes you made and how they address the feedback, enclosed in <change_summary> tags.',
      },
    ];
    this.actions = `role: assistant\ncontent:\n<improved_response>\n{\n  "test_case_title": "Receive Feedback for Actions",\n  "user_story": "As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.",\n  "acceptance_criteria": [\n    "System displays clear error messages for invalid inputs or missing fields.",\n    "System displays success messages for successful uploads and verifications."\n  ],\n  "test_cases": [\n    {\n      "test_case_name": "Invalid Input Feedback",\n      "objective": "To verify that the system displays clear error messages for invalid inputs.",\n      "preconditions": [\n        "User is logged in to the system."\n      ],\n      "test_steps": [\n        "Navigate to the upload form.",\n        "Enter invalid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays clear error messages indicating which fields contain invalid inputs.",\n        "User is prompted to correct the errors."\n      ]\n    },\n    {\n      "test_case_name": "Success Upload Verification",\n      "objective": "To verify that the system displays success messages for successful uploads and verifications.",\n      "preconditions": [\n        "User is logged in to the system.",\n        "Valid data is entered in the required fields."\n      ],\n      "test_steps": [\n        "Navigate to the upload form.",\n        "Enter valid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays a success message confirming the upload and verification.",\n        "User is notified that the information and documents have been accepted."\n      ]\n    }\n  ],\n  "summary": "This test case suite aims to verify that the system provides clear feedback to users regarding the status of their inputs and documents, whether they are accepted or need corrections."\n}\n</improved_response>\n\n<change_summary>\nThe response has been revised to ensure clarity and completeness in the test case steps. Specifically, the steps have been expanded to include navigation to the upload form, which provides a more detailed and logical sequence of actions. This addresses any potential ambiguity in the original test steps and ensures that the test cases are comprehensive and easy to follow. The structure and content remain consistent with the original output, maintaining the quality and relevance of the response.\n</change_summary>`;
    this.refrainPrompt =
      'User Stories for KYC Plus Application\n1. As a user, I want to log in to the KYC application\nSo that I can securely access my KYC profile and submit my details.\nAcceptance Criteria:\n• Login screen displays fields for Email and password.\n• User can enter valid credentials and click "Login".\n• Password input is masked for security.\n• On successful login, user is redirected to the KYC form.\n• On failed login, user receives an error message indicating invalid credentials.\nUser Stories for KYC Plus Application for ‘US’ Region <By Default>\n2. As a user, I want to enter my personal details\nSo that I can provide my full name, date of birth, and address for KYC verification.\nAcceptance Criteria:\n• Form displays fields: Full Name, Date of Birth (with calendar picker), and Address.\n• All fields are mandatory; user cannot proceed without entering these.\n• If any field is omitted, an error or prompt is shown.\n3. As a user, I want to select my state from a predefined list\nSo that my location data is standardized for KYC.\nAcceptance Criteria:\n• State field is a dropdown with all valid state options.\n• State selection is required to proceed.\n4. As a user, I want to enter my ZIP Code and Phone Number\nSo that my contact and location information is complete for verification.\nAcceptance Criteria:\n• ZIP Code and Phone Number fields follow valid formatting (ZIP: e.g., 90210; Phone: e.g., +1 9876543210).\n• Both fields are required.\n5. As a user, I want to enter my Social Security Number and Driving License Number\nSo that my identity can be verified with government-issued IDs.\nAcceptance Criteria:\n• Fields for Social Security Number and Driving License Number are present.\n• Both fields require formatting validation (SSN: 123-45-6789; DLN: e.g., D12345678).\n• Both fields must be filled before submission.\n6. As a user, I want to upload my SSN card and Driving License documents\nSo that the system can verify my identity from uploaded originals.\nAcceptance Criteria:\n• "Choose File" buttons are available for both SSN Card and Driving License.\n• Both document uploads are mandatory.\n• System validates file types and size upon upload.\n7. As a user, I want to verify my uploaded SSN and Driving License documents\nSo that I am notified of the validity of my documents before final KYC submission.\nAcceptance Criteria:\n• After upload, user can click "Verify SSN" and "Verify License".\n• System confirms validity or displays an error if verification fails.\n• User must complete verification for both before proceeding.\n8. As a user, I want to submit my completed KYC form\nSo that my details and documents are sent for final review and verification.\nAcceptance Criteria:\n• "Submit KYC" button is enabled only after all required fields are populated, files are uploaded, and documents verified.\n• System performs validation and shows a confirmation message on successful submission.\n• Missing or invalid entries are flagged for correction before submission.';

    const formatted = this.thoughts
      .map((entry) => `role: ${entry.role}\ncontent:\n${entry.content.trim()}`)
      .join('\n\n');

    this.thoughtsInput = formatted;
    this.changeDetectorRef.detectChanges();
  }

  onParentRowClick(item: any) {
    if (item?.events_output) {
      try {
        if (this.IsInfoPanelOpen) {
          this.openInfoPanel(item, true);
        }
        this.selectedEventId = item.event_id;
        this.changeDetectorRef.detectChanges();

        this.selectedEventOutput = item?.events_output?.test_cases || [];

        this.changeDetectorRef.detectChanges();
      } catch (error) {
        console.log(' Failed to parse events_output:', error);
        console.log('Cleaned String:', item.events_output);
      }
    }
  }

  openInfo(testcase: string) {
    testcase = testcase.replace(/\n/g, '<br>');
    this.sanitizedHtml = this.sanitizer.bypassSecurityTrustHtml(testcase);
  }

  getSanitizedHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(content);
  }

  testscript_link(): void {
    // Navigate to the test script page
    this._router.navigate(['/commandcenter/testscript']);
  }
  UserOnboard(): void {
    // Navigate to the user onboarding page
    this._router.navigate(['/commandcenter/useronboard']);
  }

  // Call this whenever isDisabled might change
  onFlagChange(newValue: boolean): void {
    this.isDisabled = newValue;

    if (this.isDisabled) {
      this.startPolling(); // start polling only when isDisabled is true
    } else {
      this.stopPolling(); // stop polling when false
    }
  }

  private startPolling(): void {
    if (this.pollingSubscription) return; // already running

    this.pollingSubscription = interval(5000).subscribe(() => {
      this.gettestCases();
    });

    console.log('Started polling');
  }

  private stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
    console.log('Stopped polling');
  }

  ngOnDestroy(): void {
    this.stopPolling(); // cleanup
  }

  showLoader() {
    this.isLoading = true;
  }

  hideLoader() {
    this.isLoading = false;
  }

  loadAgentSteps(agencyId: any): void {
    this._loadingService.show();
    const payload = { agency_id: agencyId };

    this._marketService.getAgentsByAgency(payload).subscribe(
      (response) => {
        const mappings = response.data?.mappings || [];
        const agents = response.data?.agents || [];

        // Join mappings with agent details
        const enrichedAgents = mappings.map((mapping: any) => {
          const agentDetails = agents.find(
            (a: any) => a.agent_id === mapping.agent_id
          );
          return {
            label: mapping.agent_name || agentDetails?.name || '',
            order: mapping.order_number || 0,
            tools: this.getToolList(agentDetails?.mcp_connector_id || ''),
          };
        });

        const sortedAgents = enrichedAgents.sort(
          (a: { order: number }, b: { order: number }) => a.order - b.order
        );

        this.agentSteps = sortedAgents.map((agent: any, index: number) => ({
          ...agent,
          isLast: index === sortedAgents.length - 1,
        }));

        this.changeDetectorRef.detectChanges();
        this._loadingService.hide();
      },
      (error) => {
        console.log('Failed to load agent steps:', error);
        this._loadingService.hide();
      }
    );
  }

  /**
   * Returns a list of tool names based on mcp_connector_id or any string
   * This assumes your connector ID contains hints like 'jira', 'sharepoint', 'excel'
   */
  getToolList(connector: string): string[] {
    const tools: string[] = [];
    const lower = connector.toLowerCase();
    if (lower.includes('jira')) tools.push('jira');
    if (lower.includes('sharepoint')) tools.push('sharepoint');
    if (lower.includes('excel')) tools.push('excel');
    if (lower.includes('doc') || lower.includes('word')) tools.push('doc');
    return tools;
  }

  showStepsDynamically() {}

  scrollToBottom() {
    const container = document.querySelector('.steps-scroll-area');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
    this.changeDetectorRef.detectChanges(); // Ensure view updates after scroll
  }

  toggleAllCheckboxes() {
    this.selectedEventOutput.forEach(
      (testCase) => (testCase.checked = this.selectAllChecked)
    );
  }

  openInfoPanel(item: any, IsOpen: boolean) {
    if (IsOpen) {
      this.selectedInfoItem = item;
      this.selectedEventId = item.event_id;
      this.IsInfoPanelOpen = true;
      this.changeDetectorRef.detectChanges();
    }
  }

  closeInfoPanel() {
    this.selectedInfoItem = null;
    this.IsInfoPanelOpen = false;
  }

  downloadSelectedTestCases() {
    const selected = this.selectedEventOutput.filter(
      (testCase) => testCase.checked
    );

    if (selected.length === 0) {
      if (this.loadalert && this.loadalert.nativeElement) {
        const modalElement = this.loadalert.nativeElement;
        $(modalElement).modal('show');
      }
      this.popupTitle = 'Excel Download!';
      this.openModal(
        'exampleModalLabel1',
        'Please select at least one test case.'
      );
      this.changeDetectorRef.detectChanges(); // manually trigger change detection

      return;
    }

    // Example: Convert selected test cases to CSV (you can format as needed)
    const csvData = this.convertToCSV(selected);
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const dateString = now.toISOString().slice(0, 10); // Gets 'YYYY-MM-DD'
    a.download = `Test-cases_${dateString}.csv`;

    a.click();
    window.URL.revokeObjectURL(url);
  }

  // Helper method to convert JSON to CSV
  convertToCSV(data: any[]): string {
    const header = [
      'Test Case ID',
      'Test Case Name',
      'Objective',
      'Preconditions',
      'Test Steps',
      'Expected Results',
      'AI Accuracy',
      'Verified by Human',
    ];

    const rows = data.map((tc, index) => [
      (index + 1).toString(), // Add index as Test Case ID (starting from 1)
      tc.test_case_name,
      tc.objective,
      (tc.preconditions || []).join('\n'),
      (tc.test_steps || []).join('\n'),
      (tc.expected_results || []).join('\n'),
      '97',
      'Yes',
    ]);

    const csv = [
      header.join(','),
      ...rows.map((row) =>
        row
          .map((field) => `"${(field ?? '').toString().replace(/"/g, '""')}"`)
          .join(',')
      ),
    ];

    return csv.join('\r\n');
  }

  openModal(messageId: string, Usermessage: string) {
    this.showModal = true;
    this.Usermessage = Usermessage;
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }
  closeModal() {
    this.showModal = false;
    this.message = '';
  }

  closealert(): void {
    this.showModal = false;
    this.message = '';
    this.popupTitle = '';
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }
}
