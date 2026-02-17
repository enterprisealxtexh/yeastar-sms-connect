import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Edit2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type SmsCategory = "otp" | "marketing" | "personal" | "transactional" | "notification" | "spam" | "unknown";

const categories: SmsCategory[] = [
  "otp",
  "marketing",
  "personal",
  "transactional",
  "notification",
  "spam",
  "unknown",
];

const categoryLabels: Record<SmsCategory, string> = {
  otp: "OTP / Verification",
  marketing: "Marketing",
  personal: "Personal",
  transactional: "Transactional",
  notification: "Notification",
  spam: "Spam",
  unknown: "Unknown",
};

interface SmsCategoryFeedbackProps {
  smsId: string;
  currentCategory: SmsCategory | null;
  onCategoryChange?: (newCategory: SmsCategory) => void;
}

export const SmsCategoryFeedback = ({ 
  smsId, 
  currentCategory, 
  onCategoryChange 
}: SmsCategoryFeedbackProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const submitFeedback = useMutation({
    mutationFn: async (newCategory: SmsCategory) => {
      // SMS category feedback not available in local SQLite mode
      toast({
        title: "Category Update Unavailable",
        description: "SMS categorization is not available in local development mode.",
        variant: "default",
      });
      return newCategory;
    },
    onSuccess: (newCategory) => {
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
      onCategoryChange?.(newCategory);
      toast({
        title: "Category Status",
        description: "SMS categorization unavailable in local mode.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          <Edit2 className="h-3 w-3" />
          <span className="sr-only">Change category</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {categories.map((category) => (
          <DropdownMenuItem
            key={category}
            onClick={() => {
              if (category !== currentCategory) {
                submitFeedback.mutate(category);
              }
              setIsOpen(false);
            }}
            disabled={submitFeedback.isPending}
          >
            <span className="flex-1">{categoryLabels[category]}</span>
            {category === currentCategory && (
              <Check className="h-4 w-4 ml-2" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
